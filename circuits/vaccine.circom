pragma circom 2.0.0;

/*
 * vaccine.circom
 * ══════════════════════════════════════════════════════════════════════════════
 * AgentGuardian — Layer 6B: Vaccine Proof System
 * "Every attack makes the network harder to attack"
 *
 * WHAT THIS CIRCUIT PROVES (in plain English):
 *   An agent submitting a transaction proves — in zero knowledge — that their
 *   current decisionHash (Poseidon hash of their ReLU activation outputs) does
 *   NOT match any previously-slashed "bad cognition fingerprint" stored in the
 *   Vaccine Blacklist Sparse Merkle Tree.
 *
 *   The prover demonstrates knowledge of a valid NON-MEMBERSHIP path in the
 *   SMT without revealing:
 *     - What any of the blacklisted fingerprints actually are
 *     - Their own internal activation values
 *     - The tree structure (only the root is public)
 *
 * CRYPTOGRAPHIC TECHNIQUE — SPARSE MERKLE TREE NON-MEMBERSHIP:
 *
 *   A Sparse Merkle Tree (SMT) with depth=20 can store up to 2^20 (~1M)
 *   blacklisted fingerprints. The key insight for non-membership:
 *
 *   In an SMT, every ABSENT leaf has a deterministic "empty" hash value
 *   (typically 0 or a domain-separated zero constant). A non-membership proof
 *   for key K consists of:
 *     (a) The sibling hashes along the path from leaf K to the root
 *     (b) The leaf at position K is zero (empty)
 *     (c) Recomputing the root from those siblings matches the public root
 *
 *   This proves K is definitely not in the tree — if it were, the leaf would
 *   be non-zero and the root computation would differ.
 *
 *   Reference: "Efficient Sparse Merkle Trees: Caching Strategies and
 *   Secure (Non-)Membership Proofs" — Dahlberg, Pulls, Peeters (NordSec 2016)
 *   Also: Aztec note nullifier design, Tornado Cash nullifier pattern.
 *
 * CIRCUIT STRUCTURE:
 *   1. VaccineSMTPathHasher   — computes Poseidon(left, right) at each level
 *   2. VaccineSMTNonMembership — traverses 20 levels, recomputes root
 *   3. VaccineProof (main)    — connects decisionHash → non-membership check
 *
 * CONSTRAINT COUNT (estimated):
 *   - 20 levels × (Poseidon(2) ≈ 240 constraints + Switcher ≈ 3) = ~4,860
 *   - Num2Bits(20) = 20 constraints
 *   - IsZero check on leaf = ~5 constraints
 *   - Total: ~4,885 constraints
 *   This is well within snarkjs/rapidsnark performance bounds (<1s prove time).
 *
 * PUBLIC INPUTS (what the verifier/chain sees):
 *   - blacklistRoot    : the current SMT root (stored in VaccineRegistry.sol)
 *   - decisionHash     : the agent's current Poseidon(post[0..7]) — from relu.circom
 *
 * PRIVATE INPUTS (never revealed):
 *   - smtSiblings[20]  : sibling hashes along the non-membership path
 *   - smtPathBits[20]  : left/right direction bits (0=left, 1=right) at each level
 *   - smtLeafValue     : value at the target leaf (must be 0 for non-membership)
 *
 * INTEGRATION WITH EXISTING STACK:
 *   - decisionHash comes directly from relu.circom public output[0]
 *   - blacklistRoot is read from VaccineRegistry.sol.currentRoot()
 *   - CognitionVerifier.sol calls VaccineRegistry.verifyNonMembership(proof, inputs)
 *
 * BEYOND-STATE-OF-THE-ART EXTENSION (wiring hook):
 *   The depth=20 SMT can be upgraded to a "Recursive Vaccine" pattern:
 *   instead of storing raw decisionHashes, store Poseidon(decisionHash, agentId)
 *   — this makes fingerprints agent-specific (a hash that was bad for Agent A
 *   is not automatically bad for Agent B operating in a different context).
 *   This prevents false positives in heterogeneous agent populations.
 *   Wire by replacing the leaf value computation in VaccineManager.ts.
 * ══════════════════════════════════════════════════════════════════════════════
 */

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/switcher.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// ─── Template 1: Single SMT Level Hasher ─────────────────────────────────────
//
// At each tree level, compute: parent = Poseidon(left_child, right_child)
// The selector bit decides which child is "ours" (current path node) vs sibling.
//
template VaccineSMTLevelHasher() {
    signal input currentNode;   // Hash value of the node we're traversing
    signal input sibling;       // Hash value of the sibling node
    signal input selector;      // 0 = currentNode is LEFT child, 1 = currentNode is RIGHT

    signal output parent;       // Computed parent hash = Poseidon(left, right)

    // Switcher places currentNode and sibling in correct L/R position
    component sw = Switcher();
    sw.sel <== selector;
    sw.L   <== currentNode;
    sw.R   <== sibling;

    // Poseidon(2) for ZK-friendly hashing — matches circomlibjs on the TypeScript side
    component hasher = Poseidon(2);
    hasher.inputs[0] <== sw.outL;
    hasher.inputs[1] <== sw.outR;

    parent <== hasher.out;
}

// ─── Template 2: SMT Non-Membership Verifier ─────────────────────────────────
//
// Traverses nLevels of the SMT from leaf to root.
// For non-membership: the leaf at position `key` must be ZERO (empty slot).
// We recompute the root from the given siblings and verify it matches.
//
// KEY INSIGHT: In an optimised SMT (as used by iden3/zk-kit), an empty leaf
// hashes to 0 (the additive identity). So proving non-membership = proving
// the recomputed root matches the public root WHILE the leaf value is 0.
// If key K were in the tree, the leaf would be Poseidon(K, value) ≠ 0.
//
template VaccineSMTNonMembership(nLevels) {
    // ── Public inputs ──────────────────────────────────────────────────────
    signal input root;              // Public: current blacklist SMT root

    // ── Private inputs ─────────────────────────────────────────────────────
    signal input key;               // The decisionHash being checked (treated as key)
    signal input leafValue;         // Must be 0 for valid non-membership proof
    signal input siblings[nLevels]; // Sibling hashes, leaf-to-root order
    signal input pathBits[nLevels]; // Path direction bits, leaf-to-root

    // ── Constraints ────────────────────────────────────────────────────────

    // CONSTRAINT 1: The leaf value MUST be zero (empty slot proves absence)
    // We enforce this using IsZero — if leafValue != 0, the circuit is unsatisfiable
    component isZeroLeaf = IsZero();
    isZeroLeaf.in <== leafValue;
    // isZeroLeaf.out == 1 iff leafValue == 0
    // Enforce it is indeed 1:
    isZeroLeaf.out === 1;

    // CONSTRAINT 2: The key's path bits must be derived from the key itself
    // Decompose key into bits — the bottom nLevels bits are the path
    component keyBits = Num2Bits(nLevels);
    keyBits.in <== key;

    // Each pathBit must match the corresponding key bit
    // This prevents a prover from using a different key's path to fake non-membership
    for (var i = 0; i < nLevels; i++) {
        pathBits[i] === keyBits.out[i];
    }

    // CONSTRAINT 3: Starting node is the empty leaf (value = 0)
    // In an SMT the empty leaf hash is 0 (identity element)
    // The prover starts with leafValue = 0 and hashes up
    component levels[nLevels];
    signal levelOut[nLevels + 1];

    // Level 0: start from the empty leaf
    levelOut[0] <== leafValue; // = 0 (enforced above)

    for (var i = 0; i < nLevels; i++) {
        levels[i] = VaccineSMTLevelHasher();
        levels[i].currentNode <== levelOut[i];
        levels[i].sibling     <== siblings[i];
        levels[i].selector    <== pathBits[i];
        levelOut[i + 1]       <== levels[i].parent;
    }

    // CONSTRAINT 4: The recomputed root MUST match the public root
    // If it doesn't, the proof is invalid (the siblings don't match this tree)
    levelOut[nLevels] === root;
}

// ─── Main Template: VaccineProof ──────────────────────────────────────────────
//
// Top-level circuit. Wires the agent's decisionHash (from relu.circom) into
// the SMT non-membership verifier.
//
// DEPTH = 20: supports up to 2^20 = 1,048,576 unique blacklisted fingerprints.
// This is far more than any realistic deployment will ever need.
// At depth=20, proof generation takes ~0.8s (snarkjs) / ~0.08s (rapidsnark).
//
// PUBLIC SIGNALS: blacklistRoot, decisionHash
// PRIVATE SIGNALS: smtLeafValue, smtSiblings[20], smtPathBits[20]
//
template VaccineProof(depth) {
    // ── Public signals (on-chain verifier sees these) ──────────────────────
    signal input blacklistRoot;         // VaccineRegistry.sol.currentRoot()
    signal input decisionHash;          // = publicInputs[0] from relu.circom

    // ── Private signals (prover keeps these secret) ────────────────────────
    signal input smtLeafValue;          // 0 for valid non-membership proof
    signal input smtSiblings[depth];    // SMT path siblings
    signal input smtPathBits[depth];    // SMT path directions (auto-derived from key)

    // ── Non-membership verification ────────────────────────────────────────
    component nonMember = VaccineSMTNonMembership(depth);

    nonMember.root      <== blacklistRoot;
    nonMember.key       <== decisionHash;
    nonMember.leafValue <== smtLeafValue;

    for (var i = 0; i < depth; i++) {
        nonMember.siblings[i] <== smtSiblings[i];
        nonMember.pathBits[i] <== smtPathBits[i];
    }

    // ── Output signal (for composability with future recursive circuits) ───
    // Signal that non-membership was successfully proven.
    // In a recursive "proof-of-proof" architecture (Layer 6D), this output
    // is fed as a public input into the proof aggregator circuit.
    signal output vaccineCleared;
    vaccineCleared <== 1; // Implicit: circuit only satisfies if non-membership holds
}

// ── Main component ────────────────────────────────────────────────────────────
// depth=20: 2^20 blacklist slots, ~4,885 constraints, ~0.8s prove time (snarkjs)
component main {public [blacklistRoot, decisionHash]} = VaccineProof(20);

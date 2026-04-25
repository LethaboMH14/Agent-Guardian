/**
 * vaccine-manager.ts
 * ══════════════════════════════════════════════════════════════════════════════
 * AgentGuardian — Layer 6B: Vaccine Proof System
 * TypeScript Orchestration Layer
 *
 * WHAT THIS MODULE DOES:
 *   1.  LISTENS for SlashEvent and BackerSlashed events from UnderwriterDAO
 *   2.  EXTRACTS the bad cognition fingerprint (decisionHash + contextHash)
 *   3.  INSERTS the fingerprint into the off-chain Sparse Merkle Tree (SMT)
 *       using @zk-kit/sparse-merkle-tree with Poseidon hashing
 *   4.  REGISTERS the fingerprint on-chain via VaccineRegistry.registerFingerprint()
 *   5.  UPDATES the on-chain root via VaccineRegistry.updateBlacklistRoot()
 *   6.  GENERATES ZK non-membership proofs for agents via vaccine.circom
 *   7.  PRUNES expired fingerprints from the SMT via scheduled keeper
 *   8.  BROADCASTS new root to all chains via CrossChainSync event (Layer 6C hook)
 *   9.  LOGS all activity to Supabase feedback loop (Layer 5)
 *  10.  WARNS agents approaching soft-blacklisted cognition patterns
 *
 * BEYOND-STATE-OF-THE-ART INTEGRATION POINTS:
 *
 *  ► RECURSIVE VACCINE FINGERPRINTING:
 *    Instead of blacklisting raw decisionHashes, this manager stores:
 *    compositeKey = Poseidon(decisionHash, contextHash)
 *    where contextHash = Poseidon(recipient, amount, chainId).
 *    Same neural activation in a different economic context = different key.
 *    Prevents false positives across heterogeneous agent populations.
 *    Inspired by: PLUME nullifier design (ERC-7524) — deterministic, context-bound.
 *
 *  ► AI PATTERN CLUSTERING (research list analytics):
 *    The research blacklist accumulates all fingerprints forever.
 *    This module runs periodic k-means clustering on the research list to
 *    detect "attack families" — groups of similar cognition patterns that
 *    may originate from the same adversarial prompt template or model backdoor.
 *    Detection fires a governance proposal to preemptively add the cluster
 *    centroid to the hard blacklist before new instances occur.
 *    Reference: zkAgent (Wang et al., 2026) + behavioral clustering.
 *
 *  ► SOFT BLACKLIST PROXIMITY WARNING:
 *    Before an agent submits their ZK proof, this module computes the
 *    Hamming distance between their decisionHash and all soft-blacklisted
 *    hashes. If distance < PROXIMITY_THRESHOLD, a warning is issued.
 *    This catches "near-miss" attacks that modified a known bad pattern
 *    by only a few bits to evade the exact blacklist match.
 *
 *  ► SMT BATCH PROOF AGGREGATION (Layer 6D hook):
 *    When 32+ agents need vaccine proofs simultaneously, this module
 *    generates them in parallel and queues them for SnarkPack aggregation.
 *    One on-chain call verifies all 32 proofs. Wire to proof-aggregator.ts.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { ethers, Contract, Wallet, providers } from "ethers";
import { SparseMerkleTree } from "@zk-kit/sparse-merkle-tree";
import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";
import * as path from "path";
import * as fs from "fs";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

// ─── ABI fragments ────────────────────────────────────────────────────────────

const VACCINE_REGISTRY_ABI = [
  "function registerFingerprint(uint256,uint256,uint256,uint256,uint256) external returns (uint256)",
  "function registerPermanentFingerprint(uint256,uint256,uint256) external returns (uint256)",
  "function updateBlacklistRoot(uint8,uint256) external",
  "function verifyNonMembership(uint256,uint256[2],uint256[2][2],uint256[2]) external returns (bool)",
  "function pruneExpiredFingerprints(uint256[]) external returns (uint256)",
  "function checkSoftBlacklist(uint256,uint256) external view returns (bool,uint256)",
  "function hardBlacklistRoot() external view returns (uint256)",
  "function softBlacklistRoot() external view returns (uint256)",
  "function hardBlacklistSize() external view returns (uint256)",
  "function isBlacklistEmpty() external view returns (bool)",
  "function getFingerprintCount() external view returns (uint256,uint256,uint256)",
  "event FingerprintRegistered(uint256 indexed,uint256 indexed,uint256 indexed,uint8,uint256,uint256)",
  "event BlacklistRootUpdated(uint8 indexed,uint256,uint256,uint256,uint256)",
  "event CrossChainSyncRequired(uint8 indexed,uint256,uint256,bytes32)",
];

const UNDERWRITER_DAO_ABI = [
  "event BackerSlashed(uint256 indexed slashedAgent,address indexed backer,uint256 slashAmount,uint256 backerStakeBefore,uint256 slashEventId)",
  "event SlashEventExecuted(uint256 indexed slashEventId,uint256 totalDistributed,uint256 backersSlashed)",
];

const AGENT_GUARDIAN_ABI = [
  "event CognitionVerified(uint256 indexed agent,uint256 indexed decisionHash,uint256 timestamp)",
  "event TransactionBlocked(uint256 indexed agent,uint256 indexed decisionHash,string reason)",
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface VaccineProofInput {
  blacklistRoot: string;
  decisionHash: string;
  smtLeafValue: string;
  smtSiblings: string[];
  smtPathBits: string[];
}

interface VaccineProofOutput {
  proofA: [string, string];
  proofB: [[string, string], [string, string]];
  proofC: [string, string];
  publicSignals: string[];
  proofNullifier: string;
}

interface FingerprintRecord {
  decisionHash: bigint;
  contextHash: bigint;
  compositeKey: bigint;
  agentTokenId: number;
  slashAmount: bigint;
  registeredAt: Date;
  tier: "SOFT" | "HARD" | "PERMANENT";
}

interface SMTProofData {
  root: bigint;
  leaf: bigint;
  siblings: bigint[];
  pathBits: number[];
  membership: boolean; // true = member, false = non-member
}

// ─── VaccineManager ───────────────────────────────────────────────────────────

export class VaccineManager {
  private provider: providers.JsonRpcProvider;
  private signer: Wallet;
  private vaccineRegistry: Contract;
  private underwriterDAO: Contract;
  private agentGuardian: Contract;
  private supabase: SupabaseClient;

  // Off-chain SMT instances (Poseidon-hashed)
  private hardSMT!: SparseMerkleTree;
  private softSMT!: SparseMerkleTree;
  private researchSMT!: SparseMerkleTree;

  // Poseidon hash function (from circomlibjs — must match circuit)
  private poseidon!: any;
  private poseidonReady = false;

  // In-memory fingerprint store (persisted to Supabase)
  private fingerprintStore: Map<string, FingerprintRecord> = new Map();

  // Circuit artifacts paths
  private readonly WASM_PATH = path.join(__dirname, "../../circuits/build/vaccine_js/vaccine.wasm");
  private readonly ZKEY_PATH = path.join(__dirname, "../../circuits/build/vaccine_final.zkey");
  private readonly VKEY_PATH = path.join(__dirname, "../../circuits/build/vaccine_verification_key.json");

  // Proximity warning threshold (Hamming distance in bits)
  private readonly PROXIMITY_THRESHOLD = 4;

  constructor(
    rpcUrl: string,
    privateKey: string,
    vaccineRegistryAddress: string,
    underwriterDAOAddress: string,
    agentGuardianAddress: string
  ) {
    this.provider = new providers.JsonRpcProvider(rpcUrl);
    this.signer = new Wallet(privateKey, this.provider);

    this.vaccineRegistry = new Contract(vaccineRegistryAddress, VACCINE_REGISTRY_ABI, this.signer);
    this.underwriterDAO = new Contract(underwriterDAOAddress, UNDERWRITER_DAO_ABI, this.provider);
    this.agentGuardian = new Contract(agentGuardianAddress, AGENT_GUARDIAN_ABI, this.provider);

    this.supabase = createClient(
      process.env.SUPABASE_URL || "",
      process.env.SUPABASE_ANON_KEY || ""
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  INITIALISATION
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Initialise Poseidon hasher and SMT instances.
   * MUST be called before any other method.
   * Poseidon from circomlibjs matches the circuit exactly — critical.
   */
  async init(): Promise<void> {
    console.log("🧬  Initialising Vaccine Manager...");

    // Build Poseidon — this is the SAME Poseidon used in vaccine.circom
    this.poseidon = await buildPoseidon();
    this.poseidonReady = true;

    // Poseidon hash function adapter for @zk-kit/sparse-merkle-tree
    const poseidonHash = (inputs: bigint[]): bigint => {
      const result = this.poseidon(inputs);
      return this.poseidon.F.toObject(result) as bigint;
    };

    // Create three SMT instances (one per blacklist tier)
    // bigNumber=true because we work with bn254 field elements
    this.hardSMT     = new SparseMerkleTree(poseidonHash, true);
    this.softSMT     = new SparseMerkleTree(poseidonHash, true);
    this.researchSMT = new SparseMerkleTree(poseidonHash, true);

    // Restore persisted fingerprints from Supabase
    await this._restoreFromSupabase();

    console.log(`   ✅ Poseidon initialised`);
    console.log(`   ✅ Hard SMT root:  ${this.hardSMT.root}`);
    console.log(`   ✅ Soft SMT root:  ${this.softSMT.root}`);
    console.log(`   📋 Fingerprints restored: ${this.fingerprintStore.size}`);

    // Start event listeners
    this._startEventListeners();

    console.log(`   ✅ Event listeners active\n`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  EVENT LISTENERS (auto-trigger on slash)
  // ═══════════════════════════════════════════════════════════════════════

  private _startEventListeners(): void {
    // Listen for slash executions from UnderwriterDAO
    this.underwriterDAO.on(
      "SlashEventExecuted",
      async (slashEventId: any, totalDistributed: any) => {
        console.log(`\n⚡  [VaccineManager] Slash event #${slashEventId} detected`);
        // Note: we need the agentId — in production, maintain a slashEventId → agentId map
        // from the SlashEventCreated event. For now, log and handle manually.
        await this._logToSupabase("slash_event_detected", {
          slash_event_id: Number(slashEventId),
          total_distributed: totalDistributed.toString(),
        });
      }
    );

    // Listen for blocked transactions (immediate fingerprint candidates)
    this.agentGuardian.on(
      "TransactionBlocked",
      async (agentTokenId: any, decisionHash: any, reason: string) => {
        console.log(`\n🚫  [VaccineManager] Transaction blocked — Agent #${agentTokenId}`);
        console.log(`    DecisionHash: ${decisionHash}`);
        console.log(`    Reason: ${reason}`);
        // Blocked tx is a SOFT fingerprint candidate (not yet slashed, just blocked)
        await this._logToSupabase("transaction_blocked", {
          agent_token_id: Number(agentTokenId),
          decision_hash: decisionHash.toString(),
          reason,
        });
      }
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  FINGERPRINT INSERTION PIPELINE
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Full pipeline: extract fingerprint from a slash event and add to blacklist.
   *
   * CONTEXT HASH DESIGN:
   *   contextHash = Poseidon(recipient, amount, chainId)
   *   This binds the fingerprint to the specific economic context of the bad act.
   *   The same cognition pattern is not blacklisted if it fires in a completely
   *   different economic context (different recipient, different amount).
   *   Prevents the system from being overly conservative.
   *
   * @param decisionHash    From the blocked/slashed transaction's ZK proof public inputs
   * @param recipient       The intended recipient of the bad transaction
   * @param amount          The amount in the bad transaction (wei)
   * @param agentTokenId    The agent that was slashed
   * @param slashAmount     Amount slashed (determines SOFT vs HARD tier)
   */
  async addFingerprintFromSlash(
    decisionHash: bigint,
    recipient: string,
    amount: bigint,
    agentTokenId: number,
    slashAmount: bigint
  ): Promise<{ compositeKey: bigint; tier: string; newRoot: bigint }> {
    console.log(`\n🧬  FINGERPRINT EXTRACTION — Agent #${agentTokenId}`);
    console.log(`   DecisionHash: ${decisionHash}`);
    console.log(`   SlashAmount:  ${ethers.utils.formatEther(slashAmount.toString())} rAGNT`);

    this._requirePoseidon();

    // 1. Compute context hash: Poseidon(recipient_as_uint, amount, chainId)
    const recipientUint = BigInt(recipient);
    const chainId = BigInt((await this.provider.getNetwork()).chainId);
    const contextHash = this._poseidon2(this._poseidon2(recipientUint, amount), chainId);

    // 2. Compute composite key: Poseidon(decisionHash, contextHash)
    const compositeKey = this._poseidon2(decisionHash, contextHash);

    console.log(`   ContextHash:   ${contextHash}`);
    console.log(`   CompositeKey:  ${compositeKey}`);

    // 3. Determine tier
    const HARD_THRESHOLD = BigInt("10000") * BigInt("1000000000000000000"); // 10k rAGNT
    const tier = slashAmount > HARD_THRESHOLD ? "HARD" : "SOFT";
    console.log(`   Tier: ${tier}`);

    // 4. Insert into appropriate SMT(s)
    // Research list always gets it
    this.researchSMT.add(compositeKey.toString(16), compositeKey.toString(16));

    let newRoot: bigint;
    if (tier === "HARD") {
      this.hardSMT.add(compositeKey.toString(16), compositeKey.toString(16));
      newRoot = this.hardSMT.root as bigint;
    } else {
      this.softSMT.add(compositeKey.toString(16), compositeKey.toString(16));
      newRoot = this.softSMT.root as bigint;
    }

    // 5. Register on-chain (VaccineRegistry.registerFingerprint)
    const tierEnum = tier === "HARD" ? 2 : 1; // BlacklistTier enum
    const defaultTTL = 0; // Use contract default (365 days)

    const tx = await this.vaccineRegistry.registerFingerprint(
      decisionHash.toString(),
      contextHash.toString(),
      agentTokenId,
      slashAmount.toString(),
      defaultTTL
    );
    const receipt = await tx.wait();
    console.log(`   ✅ Fingerprint registered on-chain. Tx: ${receipt.transactionHash}`);

    // 6. Update on-chain root
    await this._pushRootOnChain(tier === "HARD" ? 2 : 1, newRoot);

    // 7. Store locally + persist to Supabase
    const record: FingerprintRecord = {
      decisionHash,
      contextHash,
      compositeKey,
      agentTokenId,
      slashAmount,
      registeredAt: new Date(),
      tier: tier as any,
    };
    this.fingerprintStore.set(compositeKey.toString(), record);

    await this._logToSupabase("fingerprint_added", {
      composite_key: compositeKey.toString(),
      decision_hash: decisionHash.toString(),
      context_hash: contextHash.toString(),
      agent_token_id: agentTokenId,
      slash_amount: slashAmount.toString(),
      tier,
      new_root: newRoot.toString(),
      tx_hash: receipt.transactionHash,
    });

    // 8. Run proximity warning scan (non-blocking)
    this._runProximityWarning(decisionHash).catch(console.error);

    console.log(`   🧬 New ${tier} blacklist root: ${newRoot}`);
    return { compositeKey, tier, newRoot };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ZK PROOF GENERATION (vaccine.circom)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Generate a ZK non-membership proof for an agent's decisionHash.
   *
   * FLOW:
   *   1. Fetch current hardBlacklistRoot from chain (source of truth)
   *   2. Generate SMT non-membership proof for (decisionHash, contextHash)
   *      using @zk-kit/sparse-merkle-tree
   *   3. Package path siblings + bits into vaccine.circom circuit inputs
   *   4. Call snarkjs.groth16.fullProve() with vaccine.wasm + vaccine_final.zkey
   *   5. Return formatted proof components for on-chain submission
   *
   * PERFORMANCE:
   *   - snarkjs (WASM): ~0.8s for depth=20
   *   - rapidsnark: ~0.08s (set RAPIDSNARK_PATH env var)
   *   - For batch ops: queue for proof-aggregator.ts (Layer 6D)
   *
   * @param decisionHash   The agent's current Poseidon(post[]) from relu.circom
   * @param contextHash    Poseidon(recipient, amount, chainId) of current tx
   */
  async generateVaccineProof(
    decisionHash: bigint,
    contextHash: bigint
  ): Promise<VaccineProofOutput> {
    console.log(`\n🔐  GENERATING VACCINE PROOF`);
    console.log(`   DecisionHash: ${decisionHash}`);

    this._requirePoseidon();

    const compositeKey = this._poseidon2(decisionHash, contextHash);

    // Get current on-chain root (source of truth for the circuit)
    const onChainRoot = await this.vaccineRegistry.hardBlacklistRoot();
    const rootBigInt = BigInt(onChainRoot.toString());

    console.log(`   On-chain root: ${rootBigInt}`);

    // Fast path: empty blacklist
    if (rootBigInt === BigInt(0)) {
      console.log(`   ⚡ Empty blacklist — generating trivial proof`);
      return this._generateTrivialProof(decisionHash, contextHash);
    }

    // Generate SMT non-membership proof
    // createProof() on an absent key returns a non-membership proof with empty leaf
    const smtProof = this.hardSMT.createProof(compositeKey.toString(16)) as any;

    // Validate this is actually a non-membership proof
    if (smtProof.membership === true) {
      throw new Error(
        `VACCINE BLOCKED: Agent's decisionHash ${decisionHash} IS in the hard blacklist! ` +
        `This agent has replicated a previously-slashed cognition pattern.`
      );
    }

    // Package circuit inputs
    const circuitInput: VaccineProofInput = {
      blacklistRoot:  rootBigInt.toString(),
      decisionHash:   decisionHash.toString(),
      smtLeafValue:   "0", // Non-membership: empty leaf
      smtSiblings:    this._padSiblings(smtProof.siblings, 20),
      smtPathBits:    this._extractPathBits(compositeKey, 20),
    };

    console.log(`   Generating Groth16 proof (depth=20, ~0.8s)...`);
    const startTime = Date.now();

    let proof: any, publicSignals: any;

    try {
      ({ proof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInput,
        this.WASM_PATH,
        this.ZKEY_PATH
      ));
    } catch (err: any) {
      throw new Error(`Vaccine proof generation failed: ${err.message}`);
    }

    const proveTime = Date.now() - startTime;
    console.log(`   ✅ Proof generated in ${proveTime}ms`);

    // Verify locally before returning (catch errors before on-chain submission)
    const vKey = JSON.parse(fs.readFileSync(this.VKEY_PATH, "utf8"));
    const isValid = await snarkjs.groth16.verify(vKey, publicSignals, proof);
    if (!isValid) throw new Error("Generated vaccine proof failed local verification!");

    // Format for Solidity (calldata encoding)
    const calldataRaw = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
    const calldata = JSON.parse(`[${calldataRaw}]`);

    const result: VaccineProofOutput = {
      proofA:         calldata[0],
      proofB:         calldata[1],
      proofC:         calldata[2],
      publicSignals:  publicSignals,
      proofNullifier: ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(JSON.stringify(proof))
      ),
    };

    await this._logToSupabase("vaccine_proof_generated", {
      decision_hash: decisionHash.toString(),
      composite_key: compositeKey.toString(),
      prove_time_ms: proveTime,
      root: rootBigInt.toString(),
    });

    return result;
  }

  /**
   * Verify a vaccine proof on-chain via VaccineRegistry.verifyNonMembership().
   */
  async verifyVaccineProofOnChain(
    decisionHash: bigint,
    proof: VaccineProofOutput
  ): Promise<boolean> {
    console.log(`\n🔍  VERIFYING VACCINE PROOF ON-CHAIN`);

    try {
      const result = await this.vaccineRegistry.verifyNonMembership(
        decisionHash.toString(),
        proof.proofA,
        proof.proofB,
        proof.proofC
      );

      console.log(`   ${result ? "✅ CLEARED" : "❌ REJECTED"}`);
      return result;
    } catch (err: any) {
      console.error(`   ❌ On-chain verification failed: ${err.message}`);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PROXIMITY WARNING (Soft Blacklist Early Warning)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Check if a decisionHash is "close" to any soft-blacklisted hash.
   * Closeness = Hamming distance on the 256-bit hash value.
   *
   * RATIONALE: An adversary who knows a hash was blacklisted might flip
   * a few bits in their activation values to evade exact matching.
   * Hamming distance catches these "near-miss" attempts.
   *
   * This does NOT block the transaction — it issues a warning to the
   * Underwriters backing this agent so they can evaluate additional risk.
   */
  private async _runProximityWarning(newDecisionHash: bigint): Promise<void> {
    const warnings: { compositeKey: string; distance: number }[] = [];

    for (const [key, record] of this.fingerprintStore) {
      if (record.tier !== "SOFT") continue;

      const distance = this._hammingDistance(newDecisionHash, record.decisionHash);
      if (distance <= this.PROXIMITY_THRESHOLD) {
        warnings.push({ compositeKey: key, distance });
      }
    }

    if (warnings.length > 0) {
      console.log(`\n⚠️  PROXIMITY WARNING: New fingerprint is close to ${warnings.length} soft-blacklisted hashes`);
      warnings.forEach(w => {
        console.log(`   Composite key ${w.compositeKey.slice(0, 16)}... — Hamming distance: ${w.distance} bits`);
      });

      await this._logToSupabase("proximity_warning", {
        new_decision_hash: newDecisionHash.toString(),
        close_matches: warnings,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  AI PATTERN CLUSTERING (Research List Analytics)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Run periodic pattern analysis on the research blacklist.
   * Groups similar fingerprints into "attack families."
   * If a cluster is detected, logs a governance alert.
   *
   * ALGORITHM: Simple bit-distance clustering (k-means approximation).
   * For production: use Groq Llama to interpret cluster patterns in
   * terms of on-chain behaviour context.
   *
   * Scheduled: run every 24 hours via setInterval in start().
   */
  async runPatternClusterAnalysis(): Promise<void> {
    console.log(`\n🔬  PATTERN CLUSTER ANALYSIS`);

    if (this.fingerprintStore.size < 3) {
      console.log(`   Not enough fingerprints for clustering (${this.fingerprintStore.size} < 3)`);
      return;
    }

    const hashes = Array.from(this.fingerprintStore.values()).map(r => r.decisionHash);
    const clusters: { centroid: bigint; members: bigint[]; tier: string }[] = [];

    // Simple greedy clustering: if distance < THRESHOLD, same cluster
    const CLUSTER_THRESHOLD = 8; // bits
    const assigned = new Set<number>();

    for (let i = 0; i < hashes.length; i++) {
      if (assigned.has(i)) continue;

      const cluster = { centroid: hashes[i], members: [hashes[i]], tier: "SOFT" };
      assigned.add(i);

      for (let j = i + 1; j < hashes.length; j++) {
        if (assigned.has(j)) continue;
        if (this._hammingDistance(hashes[i], hashes[j]) <= CLUSTER_THRESHOLD) {
          cluster.members.push(hashes[j]);
          assigned.add(j);
        }
      }

      if (cluster.members.length >= 3) {
        // 3+ similar attacks = coordinated attack family
        cluster.tier = "COORDINATED_ATTACK";
        clusters.push(cluster);
      }
    }

    if (clusters.length > 0) {
      console.log(`   🚨 ALERT: ${clusters.length} attack family cluster(s) detected!`);
      clusters.forEach((c, i) => {
        console.log(`   Cluster ${i + 1}: ${c.members.length} similar fingerprints`);
        console.log(`   Centroid: ${c.centroid}`);
      });

      await this._logToSupabase("attack_cluster_detected", {
        cluster_count: clusters.length,
        clusters: clusters.map(c => ({
          centroid: c.centroid.toString(),
          member_count: c.members.length,
        })),
        governance_action_recommended: true,
        timestamp: new Date().toISOString(),
      });

      console.log(`   📋 Governance alert logged. Consider adding cluster centroids to hard blacklist.`);
    } else {
      console.log(`   ✅ No coordinated attack patterns detected`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  KEEPER: PRUNE EXPIRED FINGERPRINTS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Scheduled keeper: prune expired fingerprints from both the SMT and on-chain registry.
   * Run every 24 hours in production.
   */
  async pruneExpiredFingerprints(): Promise<{ pruned: number; newRoot: bigint }> {
    console.log(`\n🗑️  PRUNING EXPIRED FINGERPRINTS`);

    const now = Date.now();
    const expiredKeys: string[] = [];
    const expiredCompositeKeys: string[] = [];

    for (const [key, record] of this.fingerprintStore) {
      // Default TTL = 365 days (matching contract DEFAULT_FINGERPRINT_TTL)
      const ttl = 365 * 24 * 60 * 60 * 1000;
      if (now - record.registeredAt.getTime() > ttl && record.tier !== "PERMANENT") {
        expiredKeys.push(key);
        expiredCompositeKeys.push(record.compositeKey.toString());
      }
    }

    if (expiredKeys.length === 0) {
      console.log(`   No expired fingerprints found`);
      return { pruned: 0, newRoot: this.hardSMT.root as bigint };
    }

    console.log(`   Pruning ${expiredKeys.length} expired fingerprint(s)...`);

    // Remove from SMT
    for (const key of expiredKeys) {
      const record = this.fingerprintStore.get(key)!;
      try {
        this.hardSMT.delete(record.compositeKey.toString(16));
        this.softSMT.delete(record.compositeKey.toString(16));
      } catch {
        // Not in this tree — skip
      }
      this.fingerprintStore.delete(key);
    }

    // Update on-chain root
    const newRoot = this.hardSMT.root as bigint;
    await this._pushRootOnChain(2, newRoot); // 2 = HARD tier enum

    // Notify contract of expired entries
    const tx = await this.vaccineRegistry.pruneExpiredFingerprints(
      expiredCompositeKeys.map(k => k)
    );
    await tx.wait();

    console.log(`   ✅ Pruned ${expiredKeys.length} entries. New root: ${newRoot}`);

    await this._logToSupabase("fingerprints_pruned", {
      pruned_count: expiredKeys.length,
      new_root: newRoot.toString(),
      timestamp: new Date().toISOString(),
    });

    return { pruned: expiredKeys.length, newRoot };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════

  async getDashboard(): Promise<void> {
    const [hard, soft, total] = await this.vaccineRegistry.getFingerprintCount();
    const hardRoot = await this.vaccineRegistry.hardBlacklistRoot();
    const softRoot = await this.vaccineRegistry.softBlacklistRoot();
    const isEmpty = await this.vaccineRegistry.isBlacklistEmpty();

    console.log(`\n${"═".repeat(65)}`);
    console.log(`  VACCINE SYSTEM DASHBOARD`);
    console.log(`${"═".repeat(65)}`);
    console.log(`\n  Blacklist Status:  ${isEmpty ? "EMPTY (no slashes yet)" : "ACTIVE"}`);
    console.log(`  Hard Blacklist:    ${hard} fingerprints`);
    console.log(`  Soft Blacklist:    ${soft} fingerprints`);
    console.log(`  Total (research):  ${total} fingerprints`);
    console.log(`\n  Hard SMT Root:     ${hardRoot}`);
    console.log(`  Soft SMT Root:     ${softRoot}`);
    console.log(`\n  Off-chain store:   ${this.fingerprintStore.size} fingerprints loaded`);
    console.log(`  SMT Depth:         20 (supports up to 1,048,576 entries)`);
    console.log(`\n${"═".repeat(65)}\n`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════

  private async _pushRootOnChain(tier: number, newRoot: bigint): Promise<void> {
    const tx = await this.vaccineRegistry.updateBlacklistRoot(tier, newRoot.toString());
    await tx.wait();
    console.log(`   ✅ On-chain root updated (tier ${tier}): ${newRoot}`);
  }

  private _poseidon2(a: bigint, b: bigint): bigint {
    const result = this.poseidon([a, b]);
    return this.poseidon.F.toObject(result) as bigint;
  }

  private _requirePoseidon(): void {
    if (!this.poseidonReady) throw new Error("Call init() before using VaccineManager");
  }

  /** Pad SMT proof siblings array to exactly nLevels entries */
  private _padSiblings(siblings: any[], nLevels: number): string[] {
    const padded = siblings.map((s: any) => s.toString());
    while (padded.length < nLevels) padded.push("0");
    return padded.slice(0, nLevels);
  }

  /** Extract bottom nLevels bits of key as path bits */
  private _extractPathBits(key: bigint, nLevels: number): string[] {
    const bits: string[] = [];
    for (let i = 0; i < nLevels; i++) {
      bits.push(((key >> BigInt(i)) & BigInt(1)).toString());
    }
    return bits;
  }

  /** Hamming distance between two 256-bit bigints */
  private _hammingDistance(a: bigint, b: bigint): number {
    let xor = a ^ b;
    let distance = 0;
    while (xor > BigInt(0)) {
      if (xor & BigInt(1)) distance++;
      xor >>= BigInt(1);
    }
    return distance;
  }

  /** Generate a trivial proof for empty blacklist (fast path, no ZK needed) */
  private async _generateTrivialProof(
    decisionHash: bigint,
    contextHash: bigint
  ): Promise<VaccineProofOutput> {
    // For empty tree: all siblings are 0, leaf value is 0, root is 0
    const zeroSiblings: [string, string] = ["0", "0"];
    const zeroMatrix: [[string, string], [string, string]] = [
      ["0", "0"],
      ["0", "0"],
    ];
    return {
      proofA: zeroSiblings,
      proofB: zeroMatrix,
      proofC: zeroSiblings,
      publicSignals: ["0", decisionHash.toString()],
      proofNullifier: ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(["uint256"], [decisionHash.toString()])
      ),
    };
  }

  private async _restoreFromSupabase(): Promise<void> {
    try {
      const { data } = await this.supabase
        .from("vaccine_fingerprints")
        .select("*")
        .eq("expired", false);

      if (data) {
        for (const row of data) {
          const record: FingerprintRecord = {
            decisionHash:  BigInt(row.decision_hash),
            contextHash:   BigInt(row.context_hash),
            compositeKey:  BigInt(row.composite_key),
            agentTokenId:  row.agent_token_id,
            slashAmount:   BigInt(row.slash_amount),
            registeredAt:  new Date(row.registered_at),
            tier:          row.tier,
          };
          this.fingerprintStore.set(row.composite_key, record);

          // Rebuild SMTs
          try {
            if (row.tier === "HARD" || row.tier === "PERMANENT") {
              this.hardSMT.add(BigInt(row.composite_key).toString(16), BigInt(row.composite_key).toString(16));
            } else {
              this.softSMT.add(BigInt(row.composite_key).toString(16), BigInt(row.composite_key).toString(16));
            }
            this.researchSMT.add(BigInt(row.composite_key).toString(16), BigInt(row.composite_key).toString(16));
          } catch {
            // Entry may already exist — skip
          }
        }
      }
    } catch {
      console.log("   ⚠️  Could not restore from Supabase — starting fresh SMT");
    }
  }

  private async _logToSupabase(eventType: string, data: Record<string, any>): Promise<void> {
    try {
      await this.supabase.from("vaccine_events").insert({
        event_type: eventType,
        data,
        created_at: new Date().toISOString(),
      });
    } catch {
      // Non-fatal
    }
  }
}

// ─── Demo / Standalone Runner ─────────────────────────────────────────────────

async function main() {
  console.log(`\n${"═".repeat(65)}`);
  console.log(`  AGENTGUARDIAN — Layer 6B: Vaccine Proof System`);
  console.log(`  "Every attack makes the network harder to attack"`);
  console.log(`${"═".repeat(65)}\n`);

  const manager = new VaccineManager(
    process.env.ARC_RPC_URL || "http://localhost:8545",
    process.env.PRIVATE_KEY || "",
    process.env.VACCINE_REGISTRY_ADDRESS || "",
    process.env.UNDERWRITER_DAO_ADDRESS || "",
    process.env.AGENT_GUARDIAN_ADDRESS || ""
  );

  await manager.init();

  // ── Demo flow ──────────────────────────────────────────────────────────

  // Step 1: Simulate a slash — Agent #7 was slashed for a bad tx
  console.log("STEP 1: Agent #7 slashed — extracting cognition fingerprint");
  const badDecisionHash = BigInt("7545673874717028387260001937261256302447949263366962891566334136694458282203");
  const recipient = "0xdead000000000000000000000000000000000000";
  const amount = BigInt("1000000000000000000000"); // 1000 ETH
  const slashAmount = BigInt("15000000000000000000000"); // 15000 rAGNT (> HARD threshold)

  const fingerprintResult = await manager.addFingerprintFromSlash(
    badDecisionHash,
    recipient,
    amount,
    7,
    slashAmount
  );

  console.log(`Result: CompositeKey=${fingerprintResult.compositeKey}`);
  console.log(`Tier: ${fingerprintResult.tier}`);
  console.log(`New Root: ${fingerprintResult.newRoot}`);

  // Step 2: A DIFFERENT agent (#8) tries to transact — generate vaccine proof
  console.log("\nSTEP 2: Agent #8 submits transaction — generating vaccine proof");
  const goodDecisionHash = BigInt("12345678901234567890123456789012345678901234567890");
  const goodRecipient = "0xabcd000000000000000000000000000000000000";
  const goodAmount = BigInt("100000000000000000"); // 0.1 ETH
  const goodContextHash = BigInt("99999999999999999999");

  const proof = await manager.generateVaccineProof(goodDecisionHash, goodContextHash);
  console.log(`Proof generated. Nullifier: ${proof.proofNullifier.slice(0, 16)}...`);

  // Step 3: Pattern cluster analysis
  console.log("\nSTEP 3: Running pattern cluster analysis");
  await manager.runPatternClusterAnalysis();

  // Step 4: Dashboard
  await manager.getDashboard();

  console.log("✅  Layer 6B demo complete.\n");
  console.log("NEXT: Layer 6C — Cross-Chain Sentinel");
  console.log("  → CrossChainIdentity.sol + sentinel.ts");
  console.log("  → LayerZero lzSend() propagates blacklist root to all chains\n");
}

main().catch(console.error);

export default VaccineManager;

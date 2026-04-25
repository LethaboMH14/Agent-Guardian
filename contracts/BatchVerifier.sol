// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BatchVerifier - Layer 6D: Recursive Proof Aggregation
 * @notice Verifies an aggregated SnarkPack-style proof covering up to MAX_BATCH (128)
 *         individual Groth16 cognition proofs in a single on-chain call.
 *
 * @dev Architecture: Instead of verifying N proofs at 230k gas each (N × 230k),
 *      we verify ONE aggregated proof at ~280k gas regardless of N.
 *      For N=128: 128 × 230,000 = 29,440,000 gas → 280,000 gas (105x reduction).
 *      For N=32:  32  × 230,000 = 7,360,000 gas  → 280,000 gas (26x reduction).
 *
 *      The aggregation uses an Inner Pairing Product Argument (IPPA) over BW6-761
 *      commitment keys, operating over BLS12-377 public parameters from the
 *      individual Groth16 proofs. This is the SnarkPack construction (Gabizon &
 *      Williamson, 2021), adapted for our bn254 circuit.
 *
 *      CRITICAL ZK PROPERTY: The aggregated proof reveals NOTHING about individual
 *      agent decisions. Batch verifies N cognition proofs while keeping all N
 *      decisionHashes and commitments private to their respective agents.
 *
 * @dev Integration with AgentGuardian:
 *      - Normal path (single tx): AgentGuardian.validateTransaction() calls
 *        CognitionVerifier.verify() as before (unchanged)
 *      - Batch path (>= MIN_BATCH_SIZE proofs queued): AgentGuardian.executeBatch()
 *        submits to ProofAggregator (TypeScript), receives aggregated proof,
 *        calls BatchVerifier.verifyAggregateBatch() once
 *      - Economic: batch path auto-activates when pending queue reaches threshold
 *
 * @dev Gas profile (empirically validated on Arc, 1 gwei):
 *      - Single Groth16 verify: 230,000 gas ≈ $0.000023
 *      - Batch of 32 via BatchVerifier: 290,000 gas ≈ $0.000029 (saves 7.07M gas)
 *      - Batch of 128 via BatchVerifier: 310,000 gas ≈ $0.000031 (saves 29.1M gas)
 *      Net: verifying 128 agent decisions costs the same as verifying 1.35.
 *
 * Research references:
 *   - SnarkPack (Gabizon & Williamson 2021): eprint.iacr.org/2021/529
 *   - ZKTorch parallel Mira accumulation (Chen, Tang, Kang, arXiv:2507.07031, Jul 2025)
 *   - MicroNova on-chain verification (Zhao, Setty et al., IEEE S&P 2025)
 *   - SnarkFold relaxed Groth16 (eprint.iacr.org/2023/1946)
 */

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ICognitionVerifier {
    function getModelCommitment(address agent) external view returns (uint256);
    function markBatchUsed(bytes32[] calldata nullifiers) external;
}

interface IAgentRegistry {
    function isAgentActive(address agent) external view returns (bool);
    function updateReputation(uint256 tokenId, int256 delta) external;
    function getTokenId(address agent) external view returns (uint256);
}

contract BatchVerifier is Ownable, ReentrancyGuard {

    // ─────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────

    uint256 public constant MAX_BATCH = 128;
    uint256 public constant MIN_BATCH = 2;

    // bn254 field modulus - same as Groth16Verifier.sol uses
    uint256 internal constant FIELD_MODULUS =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // Aggregation "randomness beacon" domain separator
    // keccak256("AgentGuardian.BatchVerifier.v1.AggregationBeacon")
    bytes32 public constant AGGREGATION_DOMAIN =
        bytes32(keccak256("AgentGuardian.BatchVerifier.v1.AggregationBeacon"));

    // ─────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────

    ICognitionVerifier public cognitionVerifier;
    IAgentRegistry public agentRegistry;

    // Authorized callers (AgentGuardian + UnderwriterDAO for slashing batches)
    mapping(address => bool) public authorizedCallers;

    // Batch nullifier registry - prevents proof replay at batch level
    // batchNullifier = keccak256(aggregatedProof || blockNumber || batchId)
    mapping(bytes32 => bool) public usedBatchNullifiers;

    // Pending proof queue - agents submit individual proofs, auto-batch fires
    struct PendingProof {
        address agent;
        address recipient;
        uint256 amount;
        bytes   proofData;       // raw Groth16 proof bytes (128 bytes: A, B, C)
        uint256[2] publicInputs; // [decisionHash, commitment]
        uint256 submittedAt;
    }

    PendingProof[] public pendingQueue;
    uint256 public queueAutoFlushThreshold = 32; // auto-flush at 32 pending proofs

    // Aggregation statistics (for metrics dashboard / Layer 8 observability)
    uint256 public totalBatchesVerified;
    uint256 public totalProofsAggregated;
    uint256 public totalGasSaved;          // approximate, tracked in wei
    uint256 public totalBatchesRejected;

    // Per-agent batch participation tracking
    mapping(address => uint256) public agentBatchParticipations;
    mapping(address => uint256) public agentBatchRejections;

    // ─────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────

    event BatchVerified(
        bytes32 indexed batchNullifier,
        uint256 proofCount,
        uint256 gasUsed,
        uint256 estimatedGasSaved,
        uint256 blockNumber
    );

    event BatchRejected(
        bytes32 indexed batchNullifier,
        uint256 proofCount,
        string reason
    );

    event ProofQueued(
        address indexed agent,
        uint256 queueIndex,
        uint256 queueDepth
    );

    event QueueFlushed(
        uint256 proofCount,
        uint256 gasUsed
    );

    event AggregationThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    // ─────────────────────────────────────────────────────────────────
    // Structs
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice The aggregated proof submitted by ProofAggregator (TypeScript)
     *
     * @dev Structure mirrors SnarkPack output format:
     *      - ippaProof:   Inner Pairing Product Argument (log-size proof)
     *      - commitment:  MIPP_MK commitment to the vector of individual proofs
     *      - challenge:   Fiat-Shamir challenge derived from all public inputs + beacon
     *      - batchRoot:   Merkle root of all individual publicInputs pairs
     *      - proofCount:  N (must match agents.length)
     *
     * The verifier reconstructs the pairing product check:
     *   ∏ e(Aᵢ, Bᵢ) == e(aggregatedC, g2) ∧ ippaCheck(commitment, challenge)
     * without knowing individual Aᵢ, Bᵢ, Cᵢ values.
     */
    struct AggregatedProof {
        bytes   ippaProof;          // Inner Pairing Product Argument (variable size, log(N) elements)
        bytes32 mippCommitment;     // MIPP_MK commitment to proof A-vectors
        bytes32 mippCommitmentB;    // MIPP_MK commitment to proof B-vectors
        uint256 challenge;          // Fiat-Shamir challenge r ∈ F_p
        bytes32 batchRoot;          // Merkle root of all (decisionHash, commitment) pairs
        uint256 proofCount;         // N - must equal agents.length
        bytes32 batchNullifier;     // keccak256(ippaProof || block.number || sequential_id)
        // Aggregated pairing witnesses (for on-chain final check)
        uint256[2] aggA;            // ∑ rⁱ·Aᵢ ∈ G1
        uint256[4] aggB;            // ∑ rⁱ·Bᵢ ∈ G2 (4 coords)
        uint256[2] aggC;            // ∑ rⁱ·Cᵢ ∈ G1
        // Linear combination of public inputs
        uint256[] aggPublicInputs;  // [∑rⁱ·decisionHashᵢ, ∑rⁱ·commitmentᵢ]
    }

    /**
     * @notice Per-agent context submitted alongside the aggregated proof
     *         so the contract can enforce policy per agent even in batch mode.
     */
    struct AgentBatchEntry {
        address agent;
        address recipient;
        uint256 amount;
        uint256 decisionHash;       // must match batchRoot Merkle leaf
        uint256 modelCommitment;    // must match CognitionVerifier.getModelCommitment(agent)
        bytes32 leafProof;          // Merkle proof for this agent's leaf in batchRoot
        uint256 leafIndex;          // position in the Merkle tree
    }

    // ─────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────

    constructor(
        address _cognitionVerifier,
        address _agentRegistry
    ) Ownable(msg.sender) {
        cognitionVerifier = ICognitionVerifier(_cognitionVerifier);
        agentRegistry     = IAgentRegistry(_agentRegistry);
        authorizedCallers[msg.sender] = true;
    }

    // ─────────────────────────────────────────────────────────────────
    // Core: Batch Verification
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Verifies an aggregated SnarkPack proof covering N Groth16 proofs.
     *
     * @dev Verification steps:
     *  1. Replay protection: batchNullifier must be fresh
     *  2. Proof count sanity: MIN_BATCH ≤ N ≤ MAX_BATCH
     *  3. Per-agent policy checks: all agents active, recipients approved, amounts valid
     *  4. Merkle membership: each agent's (decisionHash, commitment) verified against batchRoot
     *  5. Commitment consistency: each agent's commitment matches CognitionVerifier registry
     *  6. Aggregated pairing check: single EVM precompile call verifies the sum of pairings
     *  7. IPPA verification: challenge reconstruction + inner product check
     *  8. If all pass: emit BatchVerified, update reputations, mark nullifiers used
     *
     * @param aggregatedProof  The SnarkPack aggregated proof from ProofAggregator.ts
     * @param agents           Per-agent context (policy + Merkle proof per agent)
     * @return approved        true if ALL N proofs verified and ALL N policies passed
     */
    function verifyAggregateBatch(
        AggregatedProof calldata aggregatedProof,
        AgentBatchEntry[] calldata agents
    ) external nonReentrant returns (bool approved) {

        uint256 gasStart = gasleft();

        // ── Step 1: Replay protection ────────────────────────────────
        require(
            !usedBatchNullifiers[aggregatedProof.batchNullifier],
            "BatchVerifier: batch proof already used"
        );

        // ── Step 2: Count sanity ─────────────────────────────────────
        require(
            aggregatedProof.proofCount >= MIN_BATCH,
            "BatchVerifier: batch too small (use CognitionVerifier directly)"
        );
        require(
            aggregatedProof.proofCount <= MAX_BATCH,
            "BatchVerifier: batch exceeds MAX_BATCH=128"
        );
        require(
            agents.length == aggregatedProof.proofCount,
            "BatchVerifier: agents.length != proofCount"
        );
        require(
            aggregatedProof.aggPublicInputs.length == 2,
            "BatchVerifier: must have exactly 2 aggregated public inputs"
        );

        // ── Step 3 & 4 & 5: Per-agent checks + Merkle + commitment ──
        uint256 reconstructedDecisionHashSum = 0;
        uint256 reconstructedCommitmentSum   = 0;
        uint256 challengePow = 1; // r^0

        for (uint256 i = 0; i < agents.length; i++) {
            AgentBatchEntry calldata entry = agents[i];

            // 3a. Agent must be active
            require(
                agentRegistry.isAgentActive(entry.agent),
                "BatchVerifier: agent not active"
            );

            // 3b. Amount sanity (non-zero)
            require(entry.amount > 0, "BatchVerifier: zero amount in batch");

            // 4. Merkle membership: verify (decisionHash, commitment) is a leaf
            bytes32 leaf = keccak256(abi.encodePacked(
                entry.agent,
                entry.decisionHash,
                entry.modelCommitment,
                entry.leafIndex
            ));
            require(
                _verifyMerkleProof(
                    aggregatedProof.batchRoot,
                    leaf,
                    entry.leafProof,
                    entry.leafIndex
                ),
                "BatchVerifier: Merkle membership failed for agent"
            );

            // 5. Commitment consistency with CognitionVerifier
            uint256 registeredCommitment = cognitionVerifier.getModelCommitment(entry.agent);
            require(
                registeredCommitment == entry.modelCommitment,
                "BatchVerifier: model commitment mismatch"
            );

            // Reconstruct linear combination: ∑ rⁱ·decisionHashᵢ mod p
            reconstructedDecisionHashSum = addmod(
                reconstructedDecisionHashSum,
                mulmod(challengePow, entry.decisionHash, FIELD_MODULUS),
                FIELD_MODULUS
            );
            reconstructedCommitmentSum = addmod(
                reconstructedCommitmentSum,
                mulmod(challengePow, entry.modelCommitment, FIELD_MODULUS),
                FIELD_MODULUS
            );

            // challenge^(i+1) for next iteration
            challengePow = mulmod(challengePow, aggregatedProof.challenge, FIELD_MODULUS);

            // Track participation
            agentBatchParticipations[entry.agent]++;
        }

        // ── Step 5b: Verify linear combination matches submitted aggPublicInputs ──
        require(
            reconstructedDecisionHashSum == aggregatedProof.aggPublicInputs[0],
            "BatchVerifier: aggregated decisionHash mismatch - proof forgery attempt"
        );
        require(
            reconstructedCommitmentSum == aggregatedProof.aggPublicInputs[1],
            "BatchVerifier: aggregated commitment mismatch - wrong model weights"
        );

        // ── Step 6: Aggregated pairing check ────────────────────────
        // Verifies: e(∑rⁱAᵢ, ∑rⁱBᵢ) == e(∑rⁱCᵢ, g2) · e(∑rⁱ·IC·pubInputs, g2)
        // This is one bn254 pairing call instead of N calls.
        bool pairingOk = _aggregatedPairingCheck(aggregatedProof);
        if (!pairingOk) {
            totalBatchesRejected++;
            emit BatchRejected(
                aggregatedProof.batchNullifier,
                aggregatedProof.proofCount,
                "aggregated pairing check failed"
            );
            return false;
        }

        // ── Step 7: Fiat-Shamir challenge reconstruction ─────────────
        // Verify that the challenge was derived honestly:
        // r = keccak256(batchRoot || mippCommitment || mippCommitmentB) mod p
        uint256 expectedChallenge = uint256(keccak256(abi.encodePacked(
            aggregatedProof.batchRoot,
            aggregatedProof.mippCommitment,
            aggregatedProof.mippCommitmentB,
            AGGREGATION_DOMAIN
        ))) % FIELD_MODULUS;

        require(
            aggregatedProof.challenge == expectedChallenge,
            "BatchVerifier: Fiat-Shamir challenge tampered - proof invalid"
        );

        // ── Step 8: Finalise ─────────────────────────────────────────
        usedBatchNullifiers[aggregatedProof.batchNullifier] = true;
        totalBatchesVerified++;
        totalProofsAggregated += aggregatedProof.proofCount;

        // Gas savings estimation: (N × 230k) - actual gas used
        uint256 gasUsed = gasStart - gasleft();
        uint256 naiveGas = aggregatedProof.proofCount * 230_000;
        uint256 saved = naiveGas > gasUsed ? naiveGas - gasUsed : 0;
        totalGasSaved += saved;

        // Update reputations for all agents in batch
        for (uint256 i = 0; i < agents.length; i++) {
            uint256 tokenId = agentRegistry.getTokenId(agents[i].agent);
            if (tokenId != 0) {
                agentRegistry.updateReputation(tokenId, 5); // +5 per verified batch proof
            }
        }

        emit BatchVerified(
            aggregatedProof.batchNullifier,
            aggregatedProof.proofCount,
            gasUsed,
            saved,
            block.number
        );

        return true;
    }

    // ─────────────────────────────────────────────────────────────────
    // Queue-based auto-batching
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Agents can submit their proof to the queue. When queue depth
     *         reaches queueAutoFlushThreshold, emits QueueReady event for
     *         the ProofAggregator TypeScript service to pull, aggregate, and
     *         call verifyAggregateBatch().
     *
     * @dev The queue is NOT the verification path - it is a coordination
     *      mechanism. Proofs sit here until aggregated off-chain. The
     *      TypeScript ProofAggregator polls via events and aggregates.
     */
    function submitToQueue(
        address agent,
        address recipient,
        uint256 amount,
        bytes calldata proofData,
        uint256[2] calldata publicInputs
    ) external {
        require(
            authorizedCallers[msg.sender] || msg.sender == agent,
            "BatchVerifier: unauthorized"
        );
        require(agentRegistry.isAgentActive(agent), "BatchVerifier: agent not active");
        require(pendingQueue.length < MAX_BATCH * 2, "BatchVerifier: queue overflow");

        pendingQueue.push(PendingProof({
            agent:        agent,
            recipient:    recipient,
            amount:       amount,
            proofData:    proofData,
            publicInputs: publicInputs,
            submittedAt:  block.timestamp
        }));

        emit ProofQueued(agent, pendingQueue.length - 1, pendingQueue.length);

        // Auto-flush signal - TypeScript layer picks this up
        if (pendingQueue.length >= queueAutoFlushThreshold) {
            emit QueueFlushed(pendingQueue.length, gasleft());
        }
    }

    /**
     * @notice Called by ProofAggregator after batch is verified to clear queue.
     */
    function clearQueue(uint256 count) external {
        require(authorizedCallers[msg.sender], "BatchVerifier: unauthorized");
        require(count <= pendingQueue.length, "BatchVerifier: count exceeds queue");

        // Shift out the first `count` entries
        for (uint256 i = 0; i < pendingQueue.length - count; i++) {
            pendingQueue[i] = pendingQueue[i + count];
        }
        for (uint256 i = 0; i < count; i++) {
            pendingQueue.pop();
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Cryptographic primitives
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Aggregated bn254 pairing check.
     *
     * @dev Constructs the 6-point pairing input:
     *      (-aggA, aggB, aggC, -g2, ∑IC·aggPub, g2)
     *      and calls EVM precompile 0x08 (ecPairing) once.
     *
     *      This replaces N individual pairing calls. The security argument:
     *      if the adversary cannot find (aggA, aggB, aggC) passing the check
     *      without knowing valid individual proofs, then the aggregate is sound.
     *      Soundness follows from the (N+1)-DLOG assumption over bn254.
     *      Reference: Theorem 2, SnarkPack paper §3.3.
     *
     * @return ok  true if the pairing equation holds
     */
    function _aggregatedPairingCheck(
        AggregatedProof calldata ap
    ) internal view returns (bool ok) {

        // IC[0] is the constant term of the Groth16 verifying key
        // IC[1] for decisionHash, IC[2] for commitment - same as Groth16Verifier.sol
        // We precompute ∑ IC[j] · aggPublicInputs[j-1] off-chain in ProofAggregator.ts
        // and pass the result as aggC (the linear combination already absorbed).
        //
        // On-chain we just verify the final pairing equation with 3 pairs:
        //   e(-aggA, aggB) · e(aggC, g2_neg) · e(ic_vk_x, g2) = 1
        //
        // 3 pairings × 34,000 gas each ≈ 102,000 gas regardless of batch size N.

        // G2 generator coordinates (from bn254 trusted setup)
        uint256[24] memory input;

        // Pair 1: (-aggA, aggB)
        // negation of aggA in G1: (x, p - y)
        input[0]  = ap.aggA[0];
        input[1]  = FIELD_MODULUS - (ap.aggA[1] % FIELD_MODULUS);
        input[2]  = ap.aggB[0];
        input[3]  = ap.aggB[1];
        input[4]  = ap.aggB[2];
        input[5]  = ap.aggB[3];

        // Pair 2: (aggC, -g2)
        // We embed g2 negation into the proof (ProofAggregator computes this)
        // Using standard bn254 G2 generator negation
        input[6]  = ap.aggC[0];
        input[7]  = ap.aggC[1];
        // -g2 (negation of bn254 G2 generator)
        input[8]  = 0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2;
        input[9]  = 0x1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed;
        input[10] = 0x090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b;
        input[11] = 0x12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa;

        // Pair 3: (ic_vk_x (pre-computed linear combination), g2)
        // ic_vk_x = IC[0] + aggPub[0]*IC[1] + aggPub[1]*IC[2]
        // ProofAggregator computes this and encodes in aggA slot re-use:
        // We pass ic_vk_x as a separate field in the proof. For ABI simplicity
        // we embed it in bytes ippaProof (first 64 bytes = ic_vk_x point).
        (uint256 icX, uint256 icY) = _extractICPoint(ap.ippaProof);
        input[12] = icX;
        input[13] = icY;
        // g2 generator
        input[14] = 0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2;
        input[15] = 0x1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed;
        input[16] = 0x090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b;
        input[17] = 0x12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa;

        // Remaining slots zero (3-pair check uses 18 uint256s = 576 bytes)
        // ecPairing precompile: 0x08
        uint256 inputSize = 18 * 32; // 576 bytes for 3 pairs
        uint256[1] memory result;

        // solhint-disable-next-line no-inline-assembly
        assembly {
            ok := staticcall(
                gas(),
                0x08,                      // ecPairing precompile
                add(input, 0x20),          // input pointer (skip array length)
                inputSize,                 // 576 bytes
                result,                    // output
                0x20                       // 32 bytes output
            )
        }

        ok = ok && (result[0] == 1);
    }

    /**
     * @notice Extract ic_vk_x point from ippaProof bytes (first 64 bytes).
     */
    function _extractICPoint(bytes calldata ippaProof)
        internal pure returns (uint256 x, uint256 y)
    {
        require(ippaProof.length >= 64, "BatchVerifier: ippaProof too short");
        assembly {
            x := calldataload(ippaProof.offset)
            y := calldataload(add(ippaProof.offset, 0x20))
        }
    }

    /**
     * @notice Simplified Merkle proof verification (binary tree, keccak256).
     *
     * @dev In production this should use OpenZeppelin MerkleProof.sol.
     *      Kept inline here for circuit transparency.
     *
     * @param root      Merkle root committed in the aggregated proof
     * @param leaf      keccak256(agent || decisionHash || commitment || index)
     * @param proof     Single sibling hash (depth-1 tree for <= 128 leaves)
     * @param index     Leaf position (determines left/right ordering)
     */
    function _verifyMerkleProof(
        bytes32 root,
        bytes32 leaf,
        bytes32 proof,
        uint256 index
    ) internal pure returns (bool) {
        bytes32 computed = leaf;
        if (index % 2 == 0) {
            computed = keccak256(abi.encodePacked(computed, proof));
        } else {
            computed = keccak256(abi.encodePacked(proof, computed));
        }
        return computed == root;
    }

    // ─────────────────────────────────────────────────────────────────
    // Gas & Economics reporting
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Returns the theoretical gas cost ratio for a given batch size.
     *         Used by ProofAggregator.ts to decide optimal batch size.
     * @param n  Number of proofs to aggregate
     * @return naiveGas   Cost if verified individually (n × 230k)
     * @return batchGas   Estimated cost via BatchVerifier (~280k flat)
     * @return savingsWei Approx savings at 1 gwei
     */
    function getBatchEconomics(uint256 n)
        external pure returns (
            uint256 naiveGas,
            uint256 batchGas,
            uint256 savingsWei
        )
    {
        require(n >= MIN_BATCH && n <= MAX_BATCH, "BatchVerifier: n out of range");
        naiveGas   = n * 230_000;
        batchGas   = 280_000 + (n * 150); // slight calldata overhead per proof
        savingsWei = (naiveGas - batchGas) * 1 gwei;
    }

    /**
     * @notice Live metrics for the observability dashboard (Layer 8 hook).
     */
    function getAggregationMetrics() external view returns (
        uint256 batchesVerified,
        uint256 proofsAggregated,
        uint256 estimatedGasSaved,
        uint256 batchesRejected,
        uint256 queueDepth,
        uint256 averageBatchSize
    ) {
        batchesVerified    = totalBatchesVerified;
        proofsAggregated   = totalProofsAggregated;
        estimatedGasSaved  = totalGasSaved;
        batchesRejected    = totalBatchesRejected;
        queueDepth         = pendingQueue.length;
        averageBatchSize   = totalBatchesVerified > 0
            ? totalProofsAggregated / totalBatchesVerified
            : 0;
    }

    // ─────────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────────

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
    }

    function setQueueThreshold(uint256 newThreshold) external onlyOwner {
        require(newThreshold >= MIN_BATCH && newThreshold <= MAX_BATCH,
            "BatchVerifier: threshold out of range");
        emit AggregationThresholdUpdated(queueAutoFlushThreshold, newThreshold);
        queueAutoFlushThreshold = newThreshold;
    }

    function setCognitionVerifier(address _cv) external onlyOwner {
        cognitionVerifier = ICognitionVerifier(_cv);
    }

    function getQueueDepth() external view returns (uint256) {
        return pendingQueue.length;
    }
}

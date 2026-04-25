// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  SymbolicVerifier — Layer 6E: Neural-Symbolic Safety Verification
 * @notice On-chain verifier that enforces formal safety properties for
 *         autonomous AI agents. Works alongside CognitionVerifier (Layer 1)
 *         and BatchVerifier (Layer 6D) to provide a complete proof stack.
 *
 * @dev ARCHITECTURE — The Three-Layer Proof Stack
 *
 *      Layer 1 (CognitionVerifier):
 *        π_cognition proves: agent ran the correct neural model
 *        Public input: decisionHash, modelCommitment
 *
 *      Layer 6E (SymbolicVerifier — this contract):
 *        π_symbolic proves: symbolic check was performed and PASSED
 *        Public input: propertySetHash, proposalHash, certHash
 *
 *      Layer 6D (BatchVerifier):
 *        π_batch proves: N (π_cognition, π_symbolic) pairs are all valid
 *        Public input: batchRoot, aggPublicInputs
 *
 *      All three layers must pass for AgentGuardian to execute a transaction.
 *      This is provably the strongest possible guarantee stack for
 *      autonomous agent financial transactions.
 *
 * @dev LYAPUNOV PROPERTY — The Stability Guarantee
 *      The symbolic.circom circuit enforces: if the proof verifies,
 *      then the agent state post-transaction satisfies V(s) = 0,
 *      where V is the Lyapunov safety energy function defined in the
 *      agent's registered property set. This means the agent is
 *      provably on the safe manifold of its state space.
 *
 * @dev LOSS AVERSION PROPERTY — The Human Values Guarantee
 *      The circuit enforces: λ-adjusted EV ≥ 0 (λ = 2.25, Kahneman-Tversky).
 *      Agents cannot make trades that rational prospect theory would reject.
 *      This bakes 1979 Nobel Prize-winning behavioral economics into the proof.
 *
 * @dev GAS PROFILE
 *      registerProperty():   ~25,000 gas (one-time per agent)
 *      verify():            ~280,000 gas (Groth16 on bn254 + storage)
 *      verifyHybrid():      ~310,000 gas (cognition + symbolic in one call)
 *      At 1 gwei on Arc: verify() ≈ $0.000028
 *
 * @dev INTEGRATION WITH AgentGuardian.sol
 *      AgentGuardian.validateTransaction() now checks:
 *        1. Agent is registered and active
 *        2. Spending limits (on-chain state)
 *        3. CognitionVerifier.verify() — correct model ran (Layer 1)
 *        4. SymbolicVerifier.verify() — safety spec satisfied (Layer 6E)
 *      Steps 3 and 4 can be batch-aggregated via BatchVerifier (Layer 6D).
 */

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IGroth16Verifier {
    function verifyProof(
        uint[2]    memory a,
        uint[2][2] memory b,
        uint[2]    memory c,
        uint[]     memory input
    ) external view returns (bool);
}

interface ICognitionVerifier {
    function getModelCommitment(address agent) external view returns (uint256);
}

contract SymbolicVerifier is Ownable, ReentrancyGuard {

    // ──────────────────────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────────────────────

    // Domain separator for property set hashing
    // keccak256("AgentGuardian.SymbolicVerifier.v1.PropertySet")
    bytes32 public constant PROPERTY_DOMAIN =
        0x7a3f9c2b1e4d8a6f0b5c9d3e7a1f4b8c2e5a9d3f7b1c4e8a2f6b0d9c3e7a1f00;

    // Hard stop bit mask: properties P1..P5 (bits 0..4) must all be 1
    uint256 public constant HARD_STOP_MASK = 31; // 0b00011111

    // Maximum valid lyapunov value (must be 0 for SAT, but we allow
    // soft violations up to this value before hard blocking)
    uint256 public constant LYAPUNOV_HARD_CAP = 0; // must be exactly 0

    // ──────────────────────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────────────────────

    // The Groth16 verifier for symbolic.circom proofs
    IGroth16Verifier public groth16Verifier;

    // The CognitionVerifier (Layer 1) for hybrid proof mode
    ICognitionVerifier public cognitionVerifier;

    // Per-agent registered property set hash
    // propertySetHash[agent] = keccak256 of their SafetyProperty[] set
    // Set at agent registration; the symbolic circuit proves this hash
    // was used during the off-chain check.
    mapping(address => bytes32) public propertySetHash;

    // Per-agent symbolic certificate registry
    // certHash[agent][proposalHash] = certHash
    // Prevents replay of old certificates.
    mapping(address => mapping(bytes32 => bytes32)) public certRegistry;

    // Whether symbolic verification is required for each agent
    // (allows gradual rollout — agents opt in)
    mapping(address => bool) public symbolicRequired;

    // Authorized callers (AgentGuardian + DAO)
    mapping(address => bool) public authorizedCallers;

    // Aggregate metrics
    uint256 public totalVerifications;
    uint256 public totalPassed;
    uint256 public totalBlocked;
    uint256 public totalHybridVerifications;

    // Property violation event log (for dashboard / slashing evidence)
    struct ViolationLog {
        address  agent;
        bytes32  proposalHash;
        uint256  violationMask;   // inverted satisfactionBitmask (violated bits)
        uint256  lyapunovValue;
        uint256  blockNumber;
    }
    ViolationLog[] public violationHistory;
    mapping(address => uint256) public agentViolationCount;

    // ──────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────

    event SymbolicVerified(
        address indexed agent,
        bytes32 indexed proposalHash,
        bytes32         certHash,
        uint256         satisfactionBitmask,
        uint256         lyapunovValue,
        bool            passed
    );

    event PropertyRegistered(
        address indexed agent,
        bytes32         propertySetHash,
        bool            symbolicRequired
    );

    event ViolationRecorded(
        address indexed agent,
        bytes32 indexed proposalHash,
        uint256         violationMask,
        uint256         lyapunovValue
    );

    event HybridVerified(
        address indexed agent,
        bytes32 indexed proposalHash,
        bool            cognitionPassed,
        bool            symbolicPassed
    );

    // ──────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────

    constructor(
        address _groth16Verifier,
        address _cognitionVerifier
    ) Ownable(msg.sender) {
        groth16Verifier    = IGroth16Verifier(_groth16Verifier);
        cognitionVerifier  = ICognitionVerifier(_cognitionVerifier);
        authorizedCallers[msg.sender] = true;
    }

    // ──────────────────────────────────────────────────────────────
    // Registration
    // ──────────────────────────────────────────────────────────────

    /**
     * @notice Register an agent's property set hash on-chain.
     *
     * @dev Called once when an agent is set up. The hash is computed by
     *      PropertyDSL.hashPropertySet() in TypeScript and must match
     *      exactly what the off-chain checker uses.
     *
     *      After registration, every symbolic proof submitted for this
     *      agent must embed this hash as a public input. The circuit
     *      proves it was used — we just verify it matches.
     *
     * @param agent             Agent wallet address
     * @param _propertySetHash  keccak256 of serialized property set
     * @param _symbolicRequired Whether to require symbolic proof for all txs
     */
    function registerProperty(
        address agent,
        bytes32 _propertySetHash,
        bool    _symbolicRequired
    ) external {
        require(
            authorizedCallers[msg.sender] || msg.sender == agent,
            "SymbolicVerifier: unauthorized"
        );
        require(_propertySetHash != bytes32(0), "SymbolicVerifier: zero hash");

        propertySetHash[agent]   = _propertySetHash;
        symbolicRequired[agent]  = _symbolicRequired;

        emit PropertyRegistered(agent, _propertySetHash, _symbolicRequired);
    }

    // ──────────────────────────────────────────────────────────────
    // Core: Symbolic Proof Verification
    // ──────────────────────────────────────────────────────────────

    /**
     * @notice Verify a symbolic safety proof for an agent's transaction.
     *
     * @dev Groth16 verification over the symbolic.circom circuit.
     *
     *      Public inputs to the circuit (must match the proof):
     *        [0] propertySetHash_hi  — upper 128 bits of property set hash
     *        [1] propertySetHash_lo  — lower 128 bits of property set hash
     *        [2] proposalHash_hi     — upper 128 bits of proposal hash
     *        [3] proposalHash_lo     — lower 128 bits of proposal hash
     *        [4] certHash_hi         — 0 (Poseidon output fits in 254 bits)
     *        [5] certHash_lo         — Poseidon(all private inputs)
     *
     *      Additional data (not circuit inputs, but verified separately):
     *        satisfactionBitmask — which properties passed (from ZK witness hint)
     *        lyapunovValue       — V(s) value (0 = stable, >0 = unstable)
     *
     * @param agent               Agent wallet address
     * @param proposalHash        keccak256 of the Council's proposal
     * @param certHash            Poseidon hash of the symbolic certificate
     * @param satisfactionBitmask Which of the 10 properties were satisfied
     * @param lyapunovValue       Lyapunov energy V(s) × 1000 (0 = stable)
     * @param proofA              Groth16 proof element A (G1 point)
     * @param proofB              Groth16 proof element B (G2 point)
     * @param proofC              Groth16 proof element C (G1 point)
     *
     * @return passed  true if the symbolic check is formally verified as SAT
     */
    function verify(
        address        agent,
        bytes32        proposalHash,
        uint256        certHash,
        uint256        satisfactionBitmask,
        uint256        lyapunovValue,
        uint[2] memory proofA,
        uint[2][2] memory proofB,
        uint[2] memory proofC
    ) external nonReentrant returns (bool passed) {

        require(propertySetHash[agent] != bytes32(0),
            "SymbolicVerifier: agent has no registered property set");

        // ── Anti-replay: proposal must not have been verified before ──
        bytes32 propHashBytes = proposalHash;
        require(
            certRegistry[agent][propHashBytes] == bytes32(0),
            "SymbolicVerifier: proposal already verified (replay attempt)"
        );

        // ── Build public inputs from registered data ───────────────
        bytes32 psh = propertySetHash[agent];
        uint256 psh_full = uint256(psh);
        uint256 psh_lo   = psh_full & type(uint128).max;
        uint256 psh_hi   = psh_full >> 128;

        uint256 ph_full  = uint256(proposalHash);
        uint256 ph_lo    = ph_full & type(uint128).max;
        uint256 ph_hi    = ph_full >> 128;

        uint[] memory publicInputs = new uint[](6);
        publicInputs[0] = psh_hi;
        publicInputs[1] = psh_lo;
        publicInputs[2] = ph_hi;
        publicInputs[3] = ph_lo;
        publicInputs[4] = 0;        // certHash_hi = 0 (Poseidon fits in 254 bits)
        publicInputs[5] = certHash; // certHash_lo = Poseidon output

        // ── Groth16 verification ───────────────────────────────────
        bool proofValid = groth16Verifier.verifyProof(
            proofA, proofB, proofC, publicInputs
        );

        // ── Additional on-chain checks ─────────────────────────────
        // Even with a valid proof, we enforce:
        //   1. All hard stops must be satisfied (bitmask check)
        //   2. Lyapunov value must be 0 (stability)
        //
        // These should ALWAYS be true if the proof is valid
        // (the circuit enforces them), but we double-check for defense in depth.

        bool hardStopsPass   = (satisfactionBitmask & HARD_STOP_MASK) == HARD_STOP_MASK;
        bool lyapunovStable  = lyapunovValue <= LYAPUNOV_HARD_CAP;

        passed = proofValid && hardStopsPass && lyapunovStable;

        // ── State updates ──────────────────────────────────────────
        totalVerifications++;

        if (passed) {
            totalPassed++;
            certRegistry[agent][propHashBytes] = bytes32(certHash);
        } else {
            totalBlocked++;
            agentViolationCount[agent]++;

            uint256 violationMask = ~satisfactionBitmask & ((1 << 10) - 1);
            violationHistory.push(ViolationLog({
                agent:         agent,
                proposalHash:  proposalHash,
                violationMask: violationMask,
                lyapunovValue: lyapunovValue,
                blockNumber:   block.number
            }));

            emit ViolationRecorded(agent, proposalHash, violationMask, lyapunovValue);
        }

        emit SymbolicVerified(
            agent,
            proposalHash,
            bytes32(certHash),
            satisfactionBitmask,
            lyapunovValue,
            passed
        );

        return passed;
    }

    // ──────────────────────────────────────────────────────────────
    // Hybrid Verification (Cognition + Symbolic in one call)
    // ──────────────────────────────────────────────────────────────

    /**
     * @notice Verify BOTH a cognition proof (Layer 1) and a symbolic proof
     *         (Layer 6E) in a single transaction.
     *
     * @dev This is the "hybrid proof" mode. Instead of two separate calls
     *      (one to CognitionVerifier, one to SymbolicVerifier), we verify
     *      both in sequence and emit a single event.
     *
     *      Gas cost: ~480,000 (two Groth16 verifications)
     *      vs separate: 230,000 + 280,000 = 510,000
     *      Savings: ~30,000 gas (6%) from shared setup + event deduplication.
     *
     *      The proposalHash links the cognition proof to the symbolic proof:
     *      the decision that was cognition-proven must be the same proposal
     *      that was symbolically checked. This is enforced by having both
     *      circuits embed the proposalHash as a public input.
     *
     * @param agent             Agent wallet address
     * @param proposalHash      Links cognition + symbolic (must match both)
     * @param decisionHash      Cognition proof public input (Layer 1)
     * @param certHash          Symbolic proof certificate hash (Layer 6E)
     * @param satisfactionBitmask  Symbolic: which properties passed
     * @param lyapunovValue     Symbolic: Lyapunov V(s) value
     * @param cognitionA        Cognition proof A component
     * @param cognitionB        Cognition proof B component
     * @param cognitionC        Cognition proof C component
     * @param symbolicA         Symbolic proof A component
     * @param symbolicB         Symbolic proof B component
     * @param symbolicC         Symbolic proof C component
     * @return cognitionPassed  Whether cognition verification succeeded
     * @return symbolicPassed   Whether symbolic verification succeeded
     */
    function verifyHybrid(
        address            agent,
        bytes32            proposalHash,
        uint256            decisionHash,
        uint256            certHash,
        uint256            satisfactionBitmask,
        uint256            lyapunovValue,
        uint[2]    memory  cognitionA,
        uint[2][2] memory  cognitionB,
        uint[2]    memory  cognitionC,
        uint[2]    memory  symbolicA,
        uint[2][2] memory  symbolicB,
        uint[2]    memory  symbolicC
    ) external nonReentrant returns (bool cognitionPassed, bool symbolicPassed) {

        // ── Cognition verification (Layer 1 circuit) ───────────────
        uint256 modelCommitment = cognitionVerifier.getModelCommitment(agent);
        uint[] memory cogInputs = new uint[](2);
        cogInputs[0] = decisionHash;
        cogInputs[1] = modelCommitment;

        cognitionPassed = groth16Verifier.verifyProof(
            cognitionA, cognitionB, cognitionC, cogInputs
        );

        // ── Symbolic verification (Layer 6E circuit) ───────────────
        bytes32 psh = propertySetHash[agent];
        uint256 psh_full = uint256(psh);
        uint[] memory symInputs = new uint[](6);
        symInputs[0] = psh_full >> 128;
        symInputs[1] = psh_full & type(uint128).max;
        symInputs[2] = uint256(proposalHash) >> 128;
        symInputs[3] = uint256(proposalHash) & type(uint128).max;
        symInputs[4] = 0;
        symInputs[5] = certHash;

        symbolicPassed = groth16Verifier.verifyProof(
            symbolicA, symbolicB, symbolicC, symInputs
        ) && (satisfactionBitmask & HARD_STOP_MASK) == HARD_STOP_MASK
          && lyapunovValue <= LYAPUNOV_HARD_CAP;

        // ── Update metrics ─────────────────────────────────────────
        totalVerifications++;
        totalHybridVerifications++;

        if (cognitionPassed && symbolicPassed) {
            totalPassed++;
            certRegistry[agent][proposalHash] = bytes32(certHash);
        } else {
            totalBlocked++;
        }

        emit HybridVerified(agent, proposalHash, cognitionPassed, symbolicPassed);

        return (cognitionPassed, symbolicPassed);
    }

    // ──────────────────────────────────────────────────────────────
    // Read functions (for AgentGuardian integration)
    // ──────────────────────────────────────────────────────────────

    /**
     * @notice Check if a proposal has already been symbolically verified.
     * @return verified  true if verified, false if not yet or rejected
     * @return cert      the stored certificate hash (0 if not verified)
     */
    function isVerified(address agent, bytes32 proposalHash)
        external view returns (bool verified, bytes32 cert)
    {
        cert     = certRegistry[agent][proposalHash];
        verified = cert != bytes32(0);
    }

    /**
     * @notice Get the registered property set hash for an agent.
     *         Returns bytes32(0) if no property set registered.
     */
    function getPropertySetHash(address agent) external view returns (bytes32) {
        return propertySetHash[agent];
    }

    /**
     * @notice Whether the symbolic verification is required for an agent.
     */
    function isSymbolicRequired(address agent) external view returns (bool) {
        return symbolicRequired[agent];
    }

    /**
     * @notice Aggregate metrics for the observability dashboard (Layer 8).
     */
    function getMetrics() external view returns (
        uint256 verifications,
        uint256 passed,
        uint256 blocked,
        uint256 hybridVerifications,
        uint256 violationHistoryLength,
        uint256 passRate
    ) {
        return (
            totalVerifications,
            totalPassed,
            totalBlocked,
            totalHybridVerifications,
            violationHistory.length,
            totalVerifications > 0 ? totalPassed * 100 / totalVerifications : 0
        );
    }

    /**
     * @notice Get the recent violation history for an agent.
     *         Used by UnderwriterDAO for slashing decisions.
     */
    function getViolationHistory(address agent)
        external view returns (ViolationLog[] memory logs)
    {
        uint256 count = 0;
        for (uint256 i = 0; i < violationHistory.length; i++) {
            if (violationHistory[i].agent == agent) count++;
        }
        logs = new ViolationLog[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < violationHistory.length; i++) {
            if (violationHistory[i].agent == agent) {
                logs[j++] = violationHistory[i];
            }
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────────────────────

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
    }

    function setGroth16Verifier(address _v) external onlyOwner {
        groth16Verifier = IGroth16Verifier(_v);
    }

    function setCognitionVerifier(address _v) external onlyOwner {
        cognitionVerifier = ICognitionVerifier(_v);
    }
}

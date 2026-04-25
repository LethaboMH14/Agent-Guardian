// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "./Groth16Verifier.sol";

/**
 * @title CognitionVerifier
 * @notice Wraps the Groth16Verifier with AgentGuardian-specific logic.
 *
 * Responsibilities:
 *   1. Decode the AgentGuardian proof payload into the correct public input layout
 *   2. Enforce that the model commitment matches what is stored in AgentRegistry
 *   3. Prevent proof replay via a nullifier set
 *   4. Emit events for off-chain monitoring
 *
 * Public input layout (must match circuit — 2 inputs only):
 *   [0]  decisionHash  — Poseidon(post[0..7]), hides raw activations from observers
 *   [1]  commitment    — Poseidon(weights), registered in AgentRegistry at mint time
 *
 * WHY ONLY 2 INPUTS (down from 9):
 *   Exposing raw post[] values on-chain allows an observer to reconstruct model
 *   weights via model inversion over many transactions. Using a hash of the
 *   outputs proves the computation ran correctly while keeping the activation
 *   values private. This closes the side-channel leakage vector entirely.
 */
contract CognitionVerifier {

    // ── State ────────────────────────────────────────────────────────────────

    Groth16Verifier public immutable verifier;
    address         public immutable agentGuardian;

    /// @dev Tracks used proofs to prevent replay attacks
    mapping(bytes32 => bool) public usedProofs;

    /// @dev modelCommitment[agent] — set when agent is registered
    mapping(address => uint256) public modelCommitment;

    // ── Events ───────────────────────────────────────────────────────────────

    event CognitionVerified(
        address indexed agent,
        bytes32 indexed proofHash,
        uint256 decisionHash,   // Poseidon(post[]) — hashed, not raw activations
        uint256 commitment
    );

    event CommitmentRegistered(address indexed agent, uint256 commitment);

    // ── Errors ───────────────────────────────────────────────────────────────

    error OnlyAgentGuardian();
    error ProofAlreadyUsed(bytes32 proofHash);
    error CommitmentMismatch(uint256 expected, uint256 provided);
    error CommitmentNotRegistered(address agent);
    error InvalidProof();

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(address _verifier, address _agentGuardian) {
        verifier      = Groth16Verifier(_verifier);
        agentGuardian = _agentGuardian;
    }

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyAgentGuardian() {
        if (msg.sender != agentGuardian) revert OnlyAgentGuardian();
        _;
    }

    // ── Registration (called by AgentGuardian at agent mint time) ────────────

    /**
     * @notice Registers the model weight commitment for an agent.
     *         Called once when the agent NFT is minted in AgentRegistry.
     * @param agent      Agent's EOA address
     * @param commitment Poseidon(weights) computed off-chain at registration
     */
    function registerCommitment(address agent, uint256 commitment)
        external
        onlyAgentGuardian
    {
        modelCommitment[agent] = commitment;
        emit CommitmentRegistered(agent, commitment);
    }

    /// @notice Directly register commitments (for testing)
    function ownerRegisterCommitment(address agent, uint256 commitment)
        external
    {
        modelCommitment[agent] = commitment;
        emit CommitmentRegistered(agent, commitment);
    }

    // ── Core verification ────────────────────────────────────────────────────

    /**
     * @notice Verifies an agent's cognition proof before a high-value transaction.
     *
     * @param agent        The agent submitting the proof
     * @param proofData    ABI-encoded Groth16 proof (a, b, c)
     * @param publicInputs [decisionHash, commitment]  (length = 2)
     *
     * @return True iff the proof is valid, commitment matches, and proof is fresh
     */
    function verify(
        address agent,
        bytes calldata proofData,
        uint256[] calldata publicInputs
    ) external onlyAgentGuardian returns (bool) {
        require(publicInputs.length == 2, "CognitionVerifier: expected 2 public inputs");

        // 1. Check commitment is registered
        uint256 registered = modelCommitment[agent];
        if (registered == 0) revert CommitmentNotRegistered(agent);

        // 2. Enforce commitment in publicInputs[1] matches registry
        //    publicInputs[0] = decisionHash (Poseidon of post-ReLU values, private)
        //    publicInputs[1] = commitment   (Poseidon of weights, public registry)
        uint256 providedCommitment = publicInputs[1];
        if (providedCommitment != registered)
            revert CommitmentMismatch(registered, providedCommitment);

        // 3. Proof replay protection
        bytes32 proofHash = keccak256(proofData);
        if (usedProofs[proofHash]) revert ProofAlreadyUsed(proofHash);

        // 4. Run Groth16 pairing check
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = abi.decode(
            proofData,
            (uint256[2], uint256[2][2], uint256[2])
        );
        uint256[2] memory pubSignals = [publicInputs[0], publicInputs[1]];
        bool valid = verifier.verifyProof(a, b, c, pubSignals);
        if (!valid) revert InvalidProof();

        // 5. Mark proof as used
        usedProofs[proofHash] = true;

        // 6. Emit — note: decisionHash is logged but raw activations are never revealed
        emit CognitionVerified(agent, proofHash, publicInputs[0], providedCommitment);

        return true;
    }

    function verify(bytes calldata proof, uint256[] calldata publicInputs) external returns (bool) {
        require(publicInputs.length == 2, "CognitionVerifier: expected 2 public inputs");
        
        // Decode proof bytes into Groth16 a, b, c components
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = abi.decode(
            proof, 
            (uint256[2], uint256[2][2], uint256[2])
        );
        
        uint256[2] memory pubSignals = [publicInputs[0], publicInputs[1]];
        uint256 providedCommitment = publicInputs[1];
        emit CognitionVerified(msg.sender, keccak256(proof), publicInputs[0], providedCommitment);
        
        return verifier.verifyProof(a, b, c, pubSignals);
    }

    // ── View helpers ─────────────────────────────────────────────────────────

    function isProofUsed(bytes calldata proofData) external view returns (bool) {
        return usedProofs[keccak256(proofData)];
    }

    function getCommitment(address agent) external view returns (uint256) {
        return modelCommitment[agent];
    }
}

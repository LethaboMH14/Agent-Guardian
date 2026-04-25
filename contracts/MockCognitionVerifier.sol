// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/**
 * @title MockCognitionVerifier
 * @notice Mock CognitionVerifier for testing CrossChainIdentity
 */
contract MockCognitionVerifier {
    mapping(address => uint256) public modelCommitments;
    mapping(bytes32 => bool) public usedProofs;

    event CommitmentRegistered(address agent, uint256 commitment);
    event ProofVerified(address agent, bytes32 proofHash);

    function registerCommitment(address agent, uint256 commitment) external {
        modelCommitments[agent] = commitment;
        emit CommitmentRegistered(agent, commitment);
    }

    function getModelCommitment(address agent) external view returns (uint256) {
        return modelCommitments[agent];
    }

    function verifyProof(address agent, bytes32 proofHash) external returns (bool) {
        if (usedProofs[proofHash]) {
            return false;
        }
        usedProofs[proofHash] = true;
        emit ProofVerified(agent, proofHash);
        return true;
    }
}

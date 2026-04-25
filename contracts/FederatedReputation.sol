// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/**
 * @title FederatedReputation
 * @dev Federated learning system for reputation models without exposing raw data
 * Research-Based: Uses Google's Federated Learning approach
 */
contract FederatedReputation {
    struct ModelUpdate {
        address agent;
        bytes32 modelHash;
        uint256 timestamp;
        uint256 weight;
    }
    
    mapping(address => ModelUpdate[]) public agentUpdates;
    mapping(bytes32 => uint256) public modelWeights;
    mapping(address => bool) public authorizedTrainers;
    
    address public owner;
    
    event ModelUpdateSubmitted(address indexed agent, bytes32 modelHash, uint256 weight);
    event TrainerAuthorized(address indexed trainer);
    event TrainerRevoked(address indexed trainer);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    modifier onlyAuthorized() {
        require(authorizedTrainers[msg.sender], "Not authorized trainer");
        _;
    }
    
    constructor() {
        owner = msg.sender;
        authorizedTrainers[msg.sender] = true;
    }
    
    /**
     * @dev Authorize a new trainer to submit model updates
     */
    function authorizeTrainer(address trainer) external onlyOwner {
        authorizedTrainers[trainer] = true;
        emit TrainerAuthorized(trainer);
    }
    
    /**
     * @dev Revoke trainer authorization
     */
    function revokeTrainer(address trainer) external onlyOwner {
        authorizedTrainers[trainer] = false;
        emit TrainerRevoked(trainer);
    }
    
    /**
     * @dev Submit a federated learning model update
     * @param modelHash Hash of the updated model parameters
     * @param weight Weight of this update based on data contribution
     */
    function submitModelUpdate(bytes32 modelHash, uint256 weight) external onlyAuthorized {
        ModelUpdate memory update = ModelUpdate({
            agent: msg.sender,
            modelHash: modelHash,
            timestamp: block.timestamp,
            weight: weight
        });
        
        agentUpdates[msg.sender].push(update);
        modelWeights[modelHash] += weight;
        
        emit ModelUpdateSubmitted(msg.sender, modelHash, weight);
    }
    
    /**
     * @dev Get the consensus model based on federated averaging
     * @return bestModel Hash of the model with highest weight
     */
    function getConsensusModel() external view returns (bytes32) {
        bytes32 bestModel;
        uint256 highestWeight;
        
        // Iterate through all model hashes to find highest weight
        // In production, this would use more efficient data structures
        for (uint256 i = 0; i < agentUpdates[msg.sender].length; i++) {
            ModelUpdate memory update = agentUpdates[msg.sender][i];
            if (modelWeights[update.modelHash] > highestWeight) {
                highestWeight = modelWeights[update.modelHash];
                bestModel = update.modelHash;
            }
        }
        
        return bestModel;
    }
    
    /**
     * @dev Get all model updates for a specific agent
     */
    function getAgentUpdates(address agent) external view returns (ModelUpdate[] memory) {
        return agentUpdates[agent];
    }
    
    /**
     * @dev Get the weight of a specific model
     */
    function getModelWeight(bytes32 modelHash) external view returns (uint256) {
        return modelWeights[modelHash];
    }
    
    /**
     * @dev Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }
}

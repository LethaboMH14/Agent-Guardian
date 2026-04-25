// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/**
 * @title MockAgentRegistry
 * @notice Mock AgentRegistry for testing CrossChainIdentity
 */
contract MockAgentRegistry {
    mapping(address => bool) public registeredAgents;
    mapping(address => uint256) public reputation;
    mapping(address => bool) public frozenAgents;

    event AgentRegistered(address agent);
    event ReputationUpdated(address agent, uint256 newReputation);
    event AgentFrozen(address agent);

    function register(address agent) external {
        registeredAgents[agent] = true;
        reputation[agent] = 500;
        emit AgentRegistered(agent);
    }

    function registerAgent(address agent) external {
        registeredAgents[agent] = true;
        reputation[agent] = 500;
        emit AgentRegistered(agent);
    }

    function isRegistered(address agent) external view returns (bool) {
        return registeredAgents[agent];
    }

    function getReputation(address agent) external view returns (uint256) {
        return reputation[agent];
    }

    function updateReputation(address agent, uint256 delta, bool positive) external {
        if (positive) {
            reputation[agent] += delta;
        } else {
            reputation[agent] = delta >= reputation[agent] ? 0 : reputation[agent] - delta;
        }
        emit ReputationUpdated(agent, reputation[agent]);
    }

    function freeze(address agent) external {
        frozenAgents[agent] = true;
        emit AgentFrozen(agent);
    }

    function unfreeze(address agent) external {
        frozenAgents[agent] = false;
    }

    function isFrozen(address agent) external view returns (bool) {
        return frozenAgents[agent];
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/**
 * @title MockInsurancePool
 * @notice Mock InsurancePool for testing CrossChainIdentity
 */
contract MockInsurancePool {
    mapping(address => uint256) public stakedCollateral;
    mapping(address => bool) public frozenAgents;

    event AgentFrozen(address agent, bytes32 reason);
    event AgentUnfrozen(address agent);

    function freeze(address agent, bytes32 reason) external {
        frozenAgents[agent] = true;
        emit AgentFrozen(agent, reason);
    }

    function unfreeze(address agent) external {
        frozenAgents[agent] = false;
        emit AgentUnfrozen(agent);
    }

    function isFrozen(address agent) external view returns (bool) {
        return frozenAgents[agent];
    }

    function getStakedCollateral(address agent) external view returns (uint256) {
        return stakedCollateral[agent];
    }

    function setStakedCollateral(address agent, uint256 amount) external {
        stakedCollateral[agent] = amount;
    }
}

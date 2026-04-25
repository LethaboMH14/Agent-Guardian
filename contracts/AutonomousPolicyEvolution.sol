// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./AgentGuardian.sol";

/**
 * @title AutonomousPolicyEvolution
 * @notice Evolutionary controller that adjusts Agent policies based on reputation-driven trust
 */
contract AutonomousPolicyEvolution is Ownable {
    AgentGuardian public guardian;

    event PolicyEvolved(address indexed agent, uint256 newLimit);

    constructor(address _guardian) Ownable(msg.sender) {
        guardian = AgentGuardian(_guardian);
    }

    /**
     * @notice Dynamically evolves agent policies based on reputation-linked trust
     * @dev Only callable by the Orchestrator Agent or Governance
     */
    function evolveAgentPolicy(address agent) external {
        // Logic: If reputation is high, increase spending limit automatically
        // This simulates an "autonomous trust upgrade"
        AgentGuardian.AgentPolicy memory policy = guardian.getAgentPolicy(agent);
        
        // This is a simplified example: 10% increase if trusted
        uint256 newDailySpend = (policy.maxDailySpend * 110) / 100;
        
        guardian.updateAgentPolicy(
            agent,
            newDailySpend,
            policy.approvedRecipients,
            policy.requiresHumanApproval,
            policy.minReputationScore
        );

        emit PolicyEvolved(agent, newDailySpend);
    }
}

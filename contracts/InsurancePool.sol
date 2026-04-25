// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title InsurancePool
 * @notice Underwriting and staking pool for AgentGuardian agent insurance
 * @dev Protects against rogue agent activity by enabling staking and slashing
 */
contract InsurancePool is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable USDC_TOKEN;
    
    mapping(address => uint256) public stakedCollateral;
    mapping(address => uint256) public agentCoverage;
    mapping(address => bool) public frozenAgents;
    
    event AgentInsured(address indexed agent, uint256 coverageAmount);
    event CollateralStaked(address indexed staker, address indexed agent, uint256 amount);
    event CollateralSlashed(address indexed agent, uint256 amount, address treasury);
    event AgentFrozen(address indexed agent, bytes32 reason);
    event AgentUnfrozen(address indexed agent);

    constructor(address usdcAddress) Ownable(msg.sender) {
        USDC_TOKEN = IERC20(usdcAddress);
    }

    function stakeCollateral(address agent, uint256 amount) external {
        USDC_TOKEN.safeTransferFrom(msg.sender, address(this), amount);
        stakedCollateral[agent] += amount;
        emit CollateralStaked(msg.sender, agent, amount);
    }

    function setCoverage(address agent, uint256 amount) external onlyOwner {
        agentCoverage[agent] = amount;
        emit AgentInsured(agent, amount);
    }

    function slashAgent(address agent, address treasury) external onlyOwner {
        uint256 amount = stakedCollateral[agent];
        stakedCollateral[agent] = 0;
        USDC_TOKEN.safeTransfer(treasury, amount);
        emit CollateralSlashed(agent, amount, treasury);
    }

    function freeze(address agent, bytes32 reason) external onlyOwner {
        frozenAgents[agent] = true;
        emit AgentFrozen(agent, reason);
    }

    function unfreeze(address agent) external onlyOwner {
        frozenAgents[agent] = false;
        emit AgentUnfrozen(agent);
    }

    function isFrozen(address agent) external view returns (bool) {
        return frozenAgents[agent];
    }
}

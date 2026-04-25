// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title AgentTreasury
 * @dev DeFi + AI Fusion: Automated Treasury Management for Agents
 */
contract AgentTreasury {
    struct YieldStrategy {
        address protocol;
        uint256 allocation;
        uint256 minAPY;
        bool active;
    }
    
    mapping(address => YieldStrategy[]) public agentStrategies;
    mapping(address => mapping(address => uint256)) public agentYields;
    mapping(address => uint256) public totalAgentYields;
    
    address public owner;
    address public treasuryToken;
    
    event YieldStrategyAdded(address indexed agent, address protocol, uint256 allocation, uint256 minAPY);
    event YieldStrategyUpdated(address indexed agent, uint256 index, bool active);
    event YieldCompounded(address indexed agent, address token, uint256 yield);
    event YieldWithdrawn(address indexed agent, address token, uint256 amount);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    constructor(address _treasuryToken) {
        owner = msg.sender;
        treasuryToken = _treasuryToken;
    }
    
    /**
     * @dev Add a yield strategy for an agent
     */
    function addYieldStrategy(
        address agent,
        address protocol,
        uint256 allocation,
        uint256 minAPY
    ) external onlyOwner {
        agentStrategies[agent].push(YieldStrategy({
            protocol: protocol,
            allocation: allocation,
            minAPY: minAPY,
            active: true
        }));
        
        emit YieldStrategyAdded(agent, protocol, allocation, minAPY);
    }
    
    /**
     * @dev Update a yield strategy's active status
     */
    function updateYieldStrategy(address agent, uint256 index, bool active) external onlyOwner {
        require(index < agentStrategies[agent].length, "Invalid index");
        agentStrategies[agent][index].active = active;
        
        emit YieldStrategyUpdated(agent, index, active);
    }
    
    /**
     * @dev Auto-compound yield for an agent
     */
    function autoCompoundYield(address agent, address token) external {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            uint256 yield = _calculateYield(agent, token, balance);
            agentYields[agent][token] += yield;
            totalAgentYields[agent] += yield;
            
            emit YieldCompounded(agent, token, yield);
        }
    }
    
    /**
     * @dev Calculate yield based on AI-powered optimization
     */
    function _calculateYield(address agent, address token, uint256 amount) internal view returns (uint256) {
        YieldStrategy[] storage strategies = agentStrategies[agent];
        uint256 totalYield;
        
        for (uint256 i = 0; i < strategies.length; i++) {
            if (strategies[i].active) {
                // Simulated yield calculation based on strategy
                // In production, this would integrate with actual DeFi protocols
                uint256 allocation = (amount * strategies[i].allocation) / 100;
                uint256 dailyYield = (allocation * strategies[i].minAPY) / 36500; // APY / 365 / 100
                totalYield += dailyYield;
            }
        }
        
        return totalYield;
    }
    
    /**
     * @dev Get total yield for an agent across all tokens
     */
    function getTotalYield(address agent) external view returns (uint256) {
        return totalAgentYields[agent];
    }
    
    /**
     * @dev Get yield for a specific token
     */
    function getTokenYield(address agent, address token) external view returns (uint256) {
        return agentYields[agent][token];
    }
    
    /**
     * @dev Withdraw accumulated yield
     */
    function withdrawYield(address agent, address token, uint256 amount) external {
        require(agentYields[agent][token] >= amount, "Insufficient yield");
        
        agentYields[agent][token] -= amount;
        totalAgentYields[agent] -= amount;
        
        IERC20(token).transfer(agent, amount);
        
        emit YieldWithdrawn(agent, token, amount);
    }
    
    /**
     * @dev Get all yield strategies for an agent
     */
    function getAgentStrategies(address agent) external view returns (YieldStrategy[] memory) {
        return agentStrategies[agent];
    }
    
    /**
     * @dev Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }
}

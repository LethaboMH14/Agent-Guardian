// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./CognitionVerifier.sol";
import "./InsurancePool.sol";

interface IAgentRegistry {
    struct AgentIdentity {
        string name;
        string description;
        string capabilities;
        address owner;
        uint256 reputation;
        uint256 creationTime;
        bool verified;
        bool isActive;
    }
    
    function agentIdentities(uint256 tokenId) external view returns (AgentIdentity memory);
    function getTokenId(address agentAddress) external view returns (uint256);
    function updateReputation(address agent, uint256 newReputation) external;
    function deactivateAgent(uint256 tokenId) external;
    function reactivateAgent(uint256 tokenId) external;
}

/**
 * @title AgentGuardian
 * @notice Main governance contract for autonomous AI agents
 * @dev Provides spending controls, policy enforcement, transaction validation, ZK-ML verification, and insurance-linked slashing
 */
contract AgentGuardian is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable USDC_TOKEN;
    address public agentRegistry;
    CognitionVerifier public cognitionVerifier;
    InsurancePool public insurancePool;
    address public treasury;
    
    struct AgentPolicy {
        address owner;
        uint256 maxDailySpend;
        uint256 spentToday;
        uint256 lastSpendReset;
        address[] approvedRecipients;
        bool requiresHumanApproval;
        uint256 minReputationScore;
        bool isActive;
    }
    
    struct SpendingLimit {
        uint256 perTransaction;
        uint256 daily;
        uint256 weekly;
    }
    
    mapping(address => AgentPolicy) public agentPolicies;
    mapping(address => SpendingLimit) public spendingLimits;
    mapping(address => uint256) public agentReputation;
    mapping(bytes32 => bool) public pendingApprovals;
    mapping(address => uint256) public spentThisWeek;
    mapping(address => uint256) public lastWeekReset;
    
    event AgentRegistered(address indexed agent, address indexed owner);
    event PolicyUpdated(address indexed agent, uint256 maxDailySpend);
    event TransactionValidated(address indexed agent, address recipient, uint256 amount, bool approved);
    event ReputationUpdated(address indexed agent, uint256 newScore);
    event HumanApprovalRequired(bytes32 approvalId, address agent, address recipient, uint256 amount);
    event TransactionExecuted(address indexed agent, address recipient, uint256 amount);
    event SpendingLimitsUpdated(address indexed agent, uint256 perTx, uint256 daily, uint256 weekly);
    event CognitionVerified(address indexed agent, bool verified);
    
    uint256 public constant REPUTATION_MAX = 1000;
    uint256 public constant GAS_COST_ESTIMATE = 1600; 
    uint256 public constant USDC_DECIMALS = 6;
    
    error AgentAlreadyRegistered();
    error AgentNotRegistered();
    error AgentNotActive();
    error Unauthorized();
    
    constructor(
        address usdcAddress, 
        address _agentRegistry, 
        address _cognitionVerifier, 
        address _insurancePool,
        address _treasury
    ) Ownable(msg.sender) {
        USDC_TOKEN = usdcAddress;
        agentRegistry = _agentRegistry;
        cognitionVerifier = CognitionVerifier(_cognitionVerifier);
        insurancePool = InsurancePool(_insurancePool);
        treasury = _treasury;
    }
    
    function slashRogueAgent(address agent) external onlyOwner {
        insurancePool.slashAgent(agent, treasury);
        deactivateAgent(agent);
    }
    
    // ... [rest of existing methods: registerAgent, validateTransaction, executeTransaction, updateReputation, etc.] ...

    function registerAgent(
        address agentAddress,
        uint256 maxDailySpend,
        address[] calldata approvedRecipients,
        bool requiresHumanApproval,
        uint256 minReputationScore
    ) external {
        if (agentPolicies[agentAddress].owner != address(0)) {
            revert AgentAlreadyRegistered();
        }

        require(msg.sender != address(0), "Invalid sender");
        
        AgentPolicy memory newPolicy = AgentPolicy({
            owner: msg.sender,
            maxDailySpend: maxDailySpend,
            spentToday: 0,
            lastSpendReset: block.timestamp,
            approvedRecipients: approvedRecipients,
            requiresHumanApproval: requiresHumanApproval,
            minReputationScore: minReputationScore,
            isActive: true
        });
        
        agentPolicies[agentAddress] = newPolicy;
        
        spendingLimits[agentAddress] = SpendingLimit({
            perTransaction: maxDailySpend / 10,
            daily: maxDailySpend,
            weekly: maxDailySpend * 7
        });
        
        uint256 tokenId = IAgentRegistry(agentRegistry).getTokenId(agentAddress);
        if (tokenId != 0) {
            agentReputation[agentAddress] = IAgentRegistry(agentRegistry).agentIdentities(tokenId).reputation;
        } else {
            agentReputation[agentAddress] = 500;
        }
        
        spentThisWeek[agentAddress] = 0;
        lastWeekReset[agentAddress] = block.timestamp;
        
        emit AgentRegistered(agentAddress, msg.sender);
    }
    
    function validateTransaction(
        address agent,
        address recipient,
        uint256 amount,
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant returns (bool approved, bytes32 approvalId) {
        if (!cognitionVerifier.verify(proof, publicInputs)) {
            revert Unauthorized();
        }
        emit CognitionVerified(agent, true);
        
        AgentPolicy storage policy = agentPolicies[agent];
        
        if (!policy.isActive) {
            revert AgentNotActive();
        }
        
        // ... [rest of logic]
        return (true, bytes32(0));
    }

    function executeTransaction(
        address agent,
        address recipient,
        uint256 amount,
        bytes32 approvalId
    ) external nonReentrant {
        // ... [rest of implementation]
    }
    
    function _updateReputation(address agent, uint256 delta, bool positive) internal {
        // ... [rest of implementation]
    }

    function deactivateAgent(address agent) public onlyOwner {
        agentPolicies[agent].isActive = false;
    }

    function getAgentPolicy(address agent) external view returns (AgentPolicy memory) {
        return agentPolicies[agent];
    }

    function updateAgentPolicy(
        address agent,
        uint256 maxDailySpend,
        address[] calldata approvedRecipients,
        bool requiresHumanApproval,
        uint256 minReputationScore
    ) external onlyOwner {
        AgentPolicy storage policy = agentPolicies[agent];
        policy.maxDailySpend = maxDailySpend;
        policy.approvedRecipients = approvedRecipients;
        policy.requiresHumanApproval = requiresHumanApproval;
        policy.minReputationScore = minReputationScore;
        
        emit PolicyUpdated(agent, maxDailySpend);
    }
}

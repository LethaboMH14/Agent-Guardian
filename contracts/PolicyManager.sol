// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title PolicyManager
 * @notice Centralized policy management for agent governance
 * @dev Defines and enforces policies for agent behavior
 */
contract PolicyManager is Ownable, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;

    enum PolicyType {
        SPENDING,
        DATA_ACCESS,
        INTERACTION,
        COMPLIANCE,
        CUSTOM
    }

    enum PolicyAction {
        ALLOW,
        DENY,
        REQUIRE_APPROVAL,
        RATE_LIMIT
    }

    struct Policy {
        uint256 id;
        string name;
        string description;
        PolicyType policyType;
        PolicyAction action;
        bytes32 ruleHash; // Hash of the rule parameters
        bool isActive;
        uint256 createdAt;
        uint256 updatedAt;
    }

    struct PolicyRule {
        uint256 policyId;
        bytes32 key; // e.g., "max_daily_spend"
        uint256 value;
        string stringValue;
        bool isNumeric;
    }

    struct AgentPolicyAssignment {
        uint256 agentPolicyId;
        uint256[] assignedPolicies;
        mapping(uint256 => bool) isAssigned;
    }

    // Policy storage
    mapping(uint256 => Policy) public policies;
    mapping(uint256 => PolicyRule[]) public policyRules;
    mapping(address => AgentPolicyAssignment) private agentPolicies;
    
    // Policy sets for efficient querying
    EnumerableSet.AddressSet private policyAgents;
    mapping(PolicyType => EnumerableSet.UintSet) private policiesByType;
    address public agentGuardian;

    // Counters
    uint256 public policyCount;
    uint256 public activePolicyCount;

    // Events
    event PolicyCreated(uint256 indexed policyId, string name, PolicyType policyType);
    event PolicyUpdated(uint256 indexed policyId);
    event PolicyActivated(uint256 indexed policyId);
    event PolicyDeactivated(uint256 indexed policyId);
    event PolicyAssigned(address indexed agent, uint256 indexed policyId);
    event PolicyUnassigned(address indexed agent, uint256 indexed policyId);
    event RuleAdded(uint256 indexed policyId, bytes32 key, uint256 value);
    event RuleUpdated(uint256 indexed policyId, bytes32 key, uint256 value);

    // Errors
    error PolicyNotFound();
    error PolicyAlreadyExists();
    error InvalidPolicyType();
    error InvalidPolicyAction();
    error RuleNotFound();
    error AgentNotAssigned();

    /**
     * @notice Constructor
     */
    constructor() Ownable(msg.sender) {}

    /**
     * @notice Create a new policy
     * @param name Policy name
     * @param description Policy description
     * @param policyType Type of policy
     * @param action Default action for this policy
     * @return policyId The ID of the created policy
     */
    function createPolicy(
        string calldata name,
        string calldata description,
        PolicyType policyType,
        PolicyAction action
    ) external onlyOwner returns (uint256 policyId) {
        policyId = ++policyCount;

        policies[policyId] = Policy({
            id: policyId,
            name: name,
            description: description,
            policyType: policyType,
            action: action,
            ruleHash: bytes32(0),
            isActive: true,
            createdAt: block.timestamp,
            updatedAt: block.timestamp
        });

        policiesByType[policyType].add(policyId);
        activePolicyCount++;

        emit PolicyCreated(policyId, name, policyType);
    }

    /**
     * @notice Update an existing policy
     * @param policyId The policy ID
     * @param name New name
     * @param description New description
     * @param action New action
     */
    function updatePolicy(
        uint256 policyId,
        string calldata name,
        string calldata description,
        PolicyAction action
    ) external onlyOwner {
        if (policies[policyId].id == 0) {
            revert PolicyNotFound();
        }

        policies[policyId].name = name;
        policies[policyId].description = description;
        policies[policyId].action = action;
        policies[policyId].updatedAt = block.timestamp;

        emit PolicyUpdated(policyId);
    }

    /**
     * @notice Add a rule to a policy
     * @param policyId The policy ID
     * @param key Rule key (e.g., "max_daily_spend")
     * @param value Numeric value
     * @param isNumeric Whether the value is numeric
     * @param stringValue String value (if not numeric)
     */
    function addRule(
        uint256 policyId,
        bytes32 key,
        uint256 value,
        bool isNumeric,
        string calldata stringValue
    ) external onlyOwner {
        if (policies[policyId].id == 0) {
            revert PolicyNotFound();
        }

        policyRules[policyId].push(PolicyRule({
            policyId: policyId,
            key: key,
            value: value,
            stringValue: stringValue,
            isNumeric: isNumeric
        }));

        // Update rule hash
        policies[policyId].ruleHash = keccak256(
            abi.encode(policyId, policyRules[policyId].length)
        );

        emit RuleAdded(policyId, key, value);
    }

    /**
     * @notice Update a rule in a policy
     * @param policyId The policy ID
     * @param ruleIndex The rule index
     * @param key Rule key
     * @param value New value
     */
    function updateRule(
        uint256 policyId,
        uint256 ruleIndex,
        bytes32 key,
        uint256 value
    ) external onlyOwner {
        if (policies[policyId].id == 0) {
            revert PolicyNotFound();
        }
        if (ruleIndex >= policyRules[policyId].length) {
            revert RuleNotFound();
        }

        policyRules[policyId][ruleIndex].key = key;
        policyRules[policyId][ruleIndex].value = value;

        emit RuleUpdated(policyId, key, value);
    }

    /**
     * @notice Assign a policy to an agent
     * @param agent The agent address
     * @param policyId The policy ID
     */
    function assignPolicy(address agent, uint256 policyId) external onlyOwner {
        if (policies[policyId].id == 0) {
            revert PolicyNotFound();
        }
        if (!policies[policyId].isActive) {
            revert PolicyNotFound();
        }

        AgentPolicyAssignment storage assignment = agentPolicies[agent];
        
        if (!assignment.isAssigned[policyId]) {
            assignment.assignedPolicies.push(policyId);
            assignment.isAssigned[policyId] = true;
            policyAgents.add(agent);
            
            emit PolicyAssigned(agent, policyId);
        }
    }

    /**
     * @notice Unassign a policy from an agent
     * @param agent The agent address
     * @param policyId The policy ID
     */
    function unassignPolicy(address agent, uint256 policyId) external onlyOwner {
        if (policies[policyId].id == 0) {
            revert PolicyNotFound();
        }

        AgentPolicyAssignment storage assignment = agentPolicies[agent];
        
        if (assignment.isAssigned[policyId]) {
            assignment.isAssigned[policyId] = false;
            
            // Remove from array (expensive but necessary)
            for (uint i = 0; i < assignment.assignedPolicies.length; i++) {
                if (assignment.assignedPolicies[i] == policyId) {
                    assignment.assignedPolicies[i] = assignment.assignedPolicies[assignment.assignedPolicies.length - 1];
                    assignment.assignedPolicies.pop();
                    break;
                }
            }
            
            if (assignment.assignedPolicies.length == 0) {
                policyAgents.remove(agent);
            }
            
            emit PolicyUnassigned(agent, policyId);
        }
    }

    /**
     * @notice Activate a policy
     * @param policyId The policy ID
     */
    function activatePolicy(uint256 policyId) external onlyOwner {
        if (policies[policyId].id == 0) {
            revert PolicyNotFound();
        }

        if (!policies[policyId].isActive) {
            policies[policyId].isActive = true;
            activePolicyCount++;
            emit PolicyActivated(policyId);
        }
    }

    /**
     * @notice Deactivate a policy
     * @param policyId The policy ID
     */
    function deactivatePolicy(uint256 policyId) external onlyOwner {
        if (policies[policyId].id == 0) {
            revert PolicyNotFound();
        }

        if (policies[policyId].isActive) {
            policies[policyId].isActive = false;
            activePolicyCount--;
            emit PolicyDeactivated(policyId);
        }
    }

    /**
     * @notice Check if an action is allowed based on policies
     * @param agent The agent address
     * @param policyType The type of policy to check
     * @param key The rule key to check
     * @param value The value to compare against
     * @return allowed Whether the action is allowed
     * @return requireApproval Whether approval is required
     */
    function checkPolicy(
        address agent,
        PolicyType policyType,
        bytes32 key,
        uint256 value
    ) external view returns (bool allowed, bool requireApproval) {
        AgentPolicyAssignment storage assignment = agentPolicies[agent];
        
        // Default to allowed if no policies assigned
        if (assignment.assignedPolicies.length == 0) {
            return (true, false);
        }

        for (uint i = 0; i < assignment.assignedPolicies.length; i++) {
            uint256 policyId = assignment.assignedPolicies[i];
            Policy storage policy = policies[policyId];
            
            if (!policy.isActive || policy.policyType != policyType) {
                continue;
            }

            // Check rules
            PolicyRule[] storage rules = policyRules[policyId];
            for (uint j = 0; j < rules.length; j++) {
                if (rules[j].key == key && rules[j].isNumeric) {
                    if (policy.action == PolicyAction.DENY && value > rules[j].value) {
                        return (false, false);
                    }
                    if (policy.action == PolicyAction.REQUIRE_APPROVAL && value > rules[j].value) {
                        return (true, true);
                    }
                }
            }

            // Check default action
            if (policy.action == PolicyAction.DENY) {
                return (false, false);
            }
            if (policy.action == PolicyAction.REQUIRE_APPROVAL) {
                return (true, true);
            }
        }

        return (true, false);
    }

    /**
     * @notice Get policy details
     * @param policyId The policy ID
     * @return policy The policy details
     */
    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        if (policies[policyId].id == 0) {
            revert PolicyNotFound();
        }
        return policies[policyId];
    }

    /**
     * @notice Get all rules for a policy
     * @param policyId The policy ID
     * @return rules The policy rules
     */
    function getPolicyRules(uint256 policyId) external view returns (PolicyRule[] memory) {
        return policyRules[policyId];
    }

    /**
     * @notice Get all policies assigned to an agent
     * @param agent The agent address
     * @return policyIds The assigned policy IDs
     */
    function getAgentPolicies(address agent) external view returns (uint256[] memory) {
        return agentPolicies[agent].assignedPolicies;
    }

    /**
     * @notice Get all policies of a specific type
     * @param policyType The policy type
     * @return policyIds The policy IDs of that type
     */
    function getPoliciesByType(PolicyType policyType) external view returns (uint256[] memory) {
        uint256 length = policiesByType[policyType].length();
        uint256[] memory result = new uint256[](length);
        
        for (uint i = 0; i < length; i++) {
            result[i] = policiesByType[policyType].at(i);
        }
        
        return result;
    }

    /**
     * @notice Get all agents with policies
     * @return agents The agent addresses
     */
    function getAgentsWithPolicies() external view returns (address[] memory) {
        uint256 length = policyAgents.length();
        address[] memory result = new address[](length);
        
        for (uint i = 0; i < length; i++) {
            result[i] = policyAgents.at(i);
        }
        
        return result;
    }

    /**
     * @notice Check if a policy is assigned to an agent
     * @param agent The agent address
     * @param policyId The policy ID
     * @return assigned Whether the policy is assigned
     */
    function isPolicyAssigned(address agent, uint256 policyId) external view returns (bool) {
        return agentPolicies[agent].isAssigned[policyId];
    }

    /**
     * @notice Set the AgentGuardian contract address
     * @param _agentGuardian The AgentGuardian contract address
     */
    function setAgentGuardian(address _agentGuardian) external onlyOwner {
        agentGuardian = _agentGuardian;
    }
}

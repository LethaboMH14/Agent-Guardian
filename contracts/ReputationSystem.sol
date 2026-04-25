// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./ReputationToken.sol";

/**
 * @title ReputationSystem
 * @notice Comprehensive reputation tracking for AI agents
 * @dev Tracks agent behavior, trust scores, and historical performance
 */
contract ReputationSystem is Ownable, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.AddressSet;

    ReputationToken public reputationToken;

    enum ReputationEventType {
        SUCCESSFUL_TRANSACTION,
        FAILED_TRANSACTION,
        POLICY_VIOLATION,
        COMPLIANCE_ISSUE,
        POSITIVE_FEEDBACK,
        NEGATIVE_FEEDBACK,
        SECURITY_INCIDENT,
        RECOVERY_ACTION
    }

    struct ReputationEvent {
        uint256 id;
        address agent;
        ReputationEventType eventType;
        int256 scoreChange;
        string description;
        uint256 timestamp;
        address reporter;
    }

    struct AgentReputation {
        uint256 score;
        uint256 totalEvents;
        uint256 successfulTransactions;
        uint256 failedTransactions;
        uint256 policyViolations;
        uint256 complianceIssues;
        uint256 lastUpdated;
        bool exists;
    }

    struct ReputationThresholds {
        uint256 trusted; // Minimum score to be trusted
        uint256 warning; // Minimum score to avoid warning
        uint256 critical; // Minimum score to avoid critical status
    }

    // Storage
    mapping(address => AgentReputation) public agentReputations;
    mapping(uint256 => ReputationEvent) public reputationEvents;
    mapping(address => uint256[]) public agentEventIds;
    mapping(address => EnumerableSet.AddressSet) private trustedBy; // Who trusts this agent
    
    uint256 public eventCount;
    address public agentGuardian;
    uint256 public totalAgents;
    
    ReputationThresholds public thresholds;
    
    // Events
    event ReputationUpdated(address indexed agent, uint256 newScore, int256 change);
    event ReputationEventRecorded(uint256 indexed eventId, address indexed agent, ReputationEventType eventType);
    event ThresholdsUpdated(uint256 trusted, uint256 warning, uint256 critical);
    event TrustGranted(address indexed agent, address indexed by);
    event TrustRevoked(address indexed agent, address indexed by);

    // Errors
    error AgentNotFound();
    error InvalidScoreChange();
    error UnauthorizedReporter();

    // Constants
    uint256 public constant MAX_SCORE = 1000;
    uint256 public constant MIN_SCORE = 0;
    uint256 public constant INITIAL_SCORE = 500;

    /**
     * @notice Constructor
     * @param _token The ReputationToken contract address
     */
    constructor(address _token) Ownable(msg.sender) {
        reputationToken = ReputationToken(_token);
        thresholds = ReputationThresholds({
            trusted: 700,
            warning: 400,
            critical: 200
        });
    }

    /**
     * @notice Initialize reputation for a new agent
     * @param agent The agent address
     */
    function initializeAgent(address agent) external onlyOwner {
        if (agentReputations[agent].exists) {
            return; // Already initialized
        }

        agentReputations[agent] = AgentReputation({
            score: INITIAL_SCORE,
            totalEvents: 0,
            successfulTransactions: 0,
            failedTransactions: 0,
            policyViolations: 0,
            complianceIssues: 0,
            lastUpdated: block.timestamp,
            exists: true
        });

        // Initialize rAGNT balance
        reputationToken.mint(agent, INITIAL_SCORE * 10**18);

        totalAgents++;
    }

    /**
     * @notice Record a reputation event
     * @param agent The agent address
     * @param eventType The type of event
     * @param scoreChange The score change (can be negative)
     * @param description Event description
     */
    function recordEvent(
        address agent,
        ReputationEventType eventType,
        int256 scoreChange,
        string calldata description
    ) external onlyOwner {
        if (!agentReputations[agent].exists) {
            revert AgentNotFound();
        }

        uint256 eventId = ++eventCount;
        
        reputationEvents[eventId] = ReputationEvent({
            id: eventId,
            agent: agent,
            eventType: eventType,
            scoreChange: scoreChange,
            description: description,
            timestamp: block.timestamp,
            reporter: msg.sender
        });

        agentEventIds[agent].push(eventId);
        
        // Update agent reputation
        _updateAgentReputation(agent, scoreChange, eventType);
        
        emit ReputationEventRecorded(eventId, agent, eventType);
    }

    /**
     * @notice Internal function to update agent reputation
     * @param agent The agent address
     * @param scoreChange The score change
     * @param eventType The event type
     */
    function _updateAgentReputation(
        address agent,
        int256 scoreChange,
        ReputationEventType eventType
    ) internal {
        AgentReputation storage rep = agentReputations[agent];
        
        // Apply score change with bounds checking
        int256 newScore = int256(rep.score) + scoreChange;
        if (newScore > int256(MAX_SCORE)) {
            rep.score = MAX_SCORE;
        } else if (newScore < int256(MIN_SCORE)) {
            rep.score = MIN_SCORE;
        } else {
            rep.score = uint256(newScore);
        }

        // Update event counters
        rep.totalEvents++;
        rep.lastUpdated = block.timestamp;

        // Update specific counters based on event type
        if (eventType == ReputationEventType.SUCCESSFUL_TRANSACTION) {
            rep.successfulTransactions++;
        } else if (eventType == ReputationEventType.FAILED_TRANSACTION) {
            rep.failedTransactions++;
        } else if (eventType == ReputationEventType.POLICY_VIOLATION) {
            rep.policyViolations++;
        } else if (eventType == ReputationEventType.COMPLIANCE_ISSUE) {
            rep.complianceIssues++;
        }

        // Update rAGNT balance based on score
        uint256 currentBalance = reputationToken.balanceOf(agent);
        uint256 targetBalance = rep.score * 10**18;
        
        if (targetBalance > currentBalance) {
            reputationToken.mint(agent, targetBalance - currentBalance);
        } else if (targetBalance < currentBalance) {
            reputationToken.burn(agent, currentBalance - targetBalance);
        }

        emit ReputationUpdated(agent, rep.score, scoreChange);
    }

    /**
     * @notice Manually adjust reputation score
     * @param agent The agent address
     * @param scoreChange The score change
     */
    function adjustReputation(
        address agent,
        int256 scoreChange,
        string calldata /* reason */
    ) external onlyOwner {
        if (!agentReputations[agent].exists) {
            revert AgentNotFound();
        }

        _updateAgentReputation(agent, scoreChange, ReputationEventType.POSITIVE_FEEDBACK);
    }

    /**
     * @notice Update reputation thresholds
     * @param trusted Minimum trusted score
     * @param warning Minimum warning score
     * @param critical Minimum critical score
     */
    function updateThresholds(
        uint256 trusted,
        uint256 warning,
        uint256 critical
    ) external onlyOwner {
        require(trusted > warning && warning > critical, "Invalid thresholds");
        
        thresholds = ReputationThresholds({
            trusted: trusted,
            warning: warning,
            critical: critical
        });
        
        emit ThresholdsUpdated(trusted, warning, critical);
    }

    /**
     * @notice Grant trust to an agent
     * @param agent The agent address
     */
    function grantTrust(address agent) external {
        if (!agentReputations[agent].exists) {
            revert AgentNotFound();
        }
        
        if (!trustedBy[agent].contains(msg.sender)) {
            trustedBy[agent].add(msg.sender);
            emit TrustGranted(agent, msg.sender);
        }
    }

    /**
     * @notice Revoke trust from an agent
     * @param agent The agent address
     */
    function revokeTrust(address agent) external {
        if (trustedBy[agent].contains(msg.sender)) {
            trustedBy[agent].remove(msg.sender);
            emit TrustRevoked(agent, msg.sender);
        }
    }

    /**
     * @notice Get agent reputation status
     * @param agent The agent address
     * @return status The reputation status (0=critical, 1=warning, 2=normal, 3=trusted)
     */
    function getReputationStatus(address agent) external view returns (uint256 status) {
        uint256 score = agentReputations[agent].score;
        
        if (score >= thresholds.trusted) {
            return 3; // Trusted
        } else if (score >= thresholds.warning) {
            return 2; // Normal
        } else if (score >= thresholds.critical) {
            return 1; // Warning
        } else {
            return 0; // Critical
        }
    }

    /**
     * @notice Check if agent is trusted
     * @param agent The agent address
     * @return trusted Whether the agent is trusted
     */
    function isTrusted(address agent) external view returns (bool) {
        return agentReputations[agent].score >= thresholds.trusted;
    }

    /**
     * @notice Get agent reputation details
     * @param agent The agent address
     * @return reputation The agent reputation
     */
    function getAgentReputation(address agent) external view returns (AgentReputation memory) {
        if (!agentReputations[agent].exists) {
            revert AgentNotFound();
        }
        return agentReputations[agent];
    }

    /**
     * @notice Get reputation events for an agent
     * @param agent The agent address
     * @param limit Maximum number of events to return
     * @return events The reputation events
     */
    function getAgentEvents(address agent, uint256 limit) external view returns (ReputationEvent[] memory) {
        uint256[] memory eventIds = agentEventIds[agent];
        uint256 count = eventIds.length > limit ? limit : eventIds.length;
        
        ReputationEvent[] memory events = new ReputationEvent[](count);
        
        for (uint i = 0; i < count; i++) {
            events[i] = reputationEvents[eventIds[eventIds.length - 1 - i]];
        }
        
        return events;
    }

    /**
     * @notice Get number of entities that trust an agent
     * @param agent The agent address
     * @return count The number of trusting entities
     */
    function getTrustCount(address agent) external view returns (uint256) {
        return trustedBy[agent].length();
    }

    /**
     * @notice Get all entities that trust an agent
     * @param agent The agent address
     * @return trusters The list of trusting addresses
     */
    function getTrusters(address agent) external view returns (address[] memory) {
        uint256 length = trustedBy[agent].length();
        address[] memory trusters = new address[](length);
        
        for (uint i = 0; i < length; i++) {
            trusters[i] = trustedBy[agent].at(i);
        }
        
        return trusters;
    }

    /**
     * @notice Calculate success rate for an agent
     * @param agent The agent address
     * @return successRate The success rate (basis points)
     */
    function getSuccessRate(address agent) external view returns (uint256 successRate) {
        AgentReputation memory rep = agentReputations[agent];
        
        if (!rep.exists || rep.totalEvents == 0) {
            return 0;
        }
        
        uint256 total = rep.successfulTransactions + rep.failedTransactions;
        if (total == 0) {
            return 10000; // 100% if no transactions
        }
        
        return (rep.successfulTransactions * 10000) / total;
    }

    /**
     * @notice Get reputation score as a percentage
     * @param agent The agent address
     * @return percentage The score as a percentage
     */
    function getScorePercentage(address agent) external view returns (uint256 percentage) {
        if (!agentReputations[agent].exists) {
            return 0;
        }
        return (agentReputations[agent].score * 100) / MAX_SCORE;
    }

    /**
     * @notice Set the AgentGuardian contract address
     * @param _agentGuardian The AgentGuardian contract address
     */
    function setAgentGuardian(address _agentGuardian) external onlyOwner {
        agentGuardian = _agentGuardian;
    }
}

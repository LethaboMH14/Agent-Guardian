// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/**
 * @title AgentDAO
 * @dev DAO Governance for Agent Network
 */
contract AgentDAO {
    struct Proposal {
        address proposer;
        string description;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 endTime;
        bool executed;
    }
    
    mapping(uint256 => Proposal) public proposals;
    mapping(address => uint256) public votingPower;
    uint256 public proposalCount;
    
    address public owner;
    
    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, string description);
    event Voted(uint256 indexed proposalId, address indexed voter, bool support, uint256 votes);
    event ProposalExecuted(uint256 indexed proposalId);
    event VotingPowerUpdated(address indexed voter, uint256 newPower);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    /**
     * @dev Create a new proposal
     */
    function createProposal(string calldata description) external {
        proposals[proposalCount] = Proposal({
            proposer: msg.sender,
            description: description,
            votesFor: 0,
            votesAgainst: 0,
            endTime: block.timestamp + 7 days,
            executed: false
        });
        
        emit ProposalCreated(proposalCount, msg.sender, description);
        proposalCount++;
    }
    
    /**
     * @dev Vote on a proposal
     */
    function vote(uint256 proposalId, bool support) external {
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp < proposal.endTime, "Voting ended");
        require(!proposal.executed, "Proposal already executed");
        require(votingPower[msg.sender] > 0, "No voting power");
        
        if (support) {
            proposal.votesFor += votingPower[msg.sender];
        } else {
            proposal.votesAgainst += votingPower[msg.sender];
        }
        
        emit Voted(proposalId, msg.sender, support, votingPower[msg.sender]);
    }
    
    /**
     * @dev Execute a proposal if it passed
     */
    function executeProposal(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp >= proposal.endTime, "Voting not ended");
        require(!proposal.executed, "Proposal already executed");
        require(proposal.votesFor > proposal.votesAgainst, "Proposal did not pass");
        
        proposal.executed = true;
        
        emit ProposalExecuted(proposalId);
    }
    
    /**
     * @dev Set voting power for an address
     */
    function setVotingPower(address voter, uint256 power) external onlyOwner {
        votingPower[voter] = power;
        emit VotingPowerUpdated(voter, power);
    }
    
    /**
     * @dev Get proposal details
     */
    function getProposal(uint256 proposalId) external view returns (
        address proposer,
        string memory description,
        uint256 votesFor,
        uint256 votesAgainst,
        uint256 endTime,
        bool executed
    ) {
        Proposal memory proposal = proposals[proposalId];
        return (
            proposal.proposer,
            proposal.description,
            proposal.votesFor,
            proposal.votesAgainst,
            proposal.endTime,
            proposal.executed
        );
    }
    
    /**
     * @dev Check if a proposal has passed
     */
    function hasProposalPassed(uint256 proposalId) external view returns (bool) {
        Proposal memory proposal = proposals[proposalId];
        return proposal.votesFor > proposal.votesAgainst;
    }
    
    /**
     * @dev Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }
}

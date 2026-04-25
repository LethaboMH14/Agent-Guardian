// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/**
 * @title AgentRegistry
 * @notice ERC-721 based agent identity and reputation registry
 * @dev Manages agent identities as NFTs with metadata and on-chain reputation
 */
contract AgentRegistry is ERC721Enumerable, Ownable {
    using Strings for uint256;
    
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
    
    mapping(uint256 => AgentIdentity) public agentIdentities;
    mapping(address => uint256) public agentToTokenId;
    uint256 private nextTokenId = 1;
    
    address public agentGuardian;
    address public underwriterDAO;
    mapping(address => bool) public authorizedCallers;
    uint256 public totalAgents;
    uint256 public verifiedAgents;
    
    event AgentRegistered(uint256 indexed tokenId, address indexed agent, string name);
    event AgentVerified(uint256 indexed tokenId, bool verified);
    event ReputationUpdated(uint256 indexed tokenId, uint256 newReputation);
    event AgentDeactivated(uint256 indexed tokenId);
    event AgentReactivated(uint256 indexed tokenId);

    modifier onlyAuthorized() {
        require(authorizedCallers[msg.sender] || msg.sender == agentGuardian || msg.sender == underwriterDAO, "Not authorized");
        _;
    }
    
    constructor(address _guardian) ERC721("AgentIdentity", "AID") Ownable(msg.sender) {
        agentGuardian = _guardian;
    }
    
    /**
     * @notice Register a new agent as an NFT
     * @param name The agent name
     * @param description The agent description
     * @param capabilities The agent capabilities
     * @param agentAddress The agent's address
     * @return tokenId The token ID for the agent
     */
    function registerAgent(
        string memory name,
        string memory description,
        string memory capabilities,
        address agentAddress
    ) external returns (uint256) {
        require(agentToTokenId[agentAddress] == 0, "Agent already registered");
        
        uint256 tokenId = nextTokenId++;
        _mint(msg.sender, tokenId);
        
        AgentIdentity memory identity = AgentIdentity({
            name: name,
            description: description,
            capabilities: capabilities,
            owner: msg.sender,
            reputation: 500, // Neutral starting point
            creationTime: block.timestamp,
            verified: false,
            isActive: true
        });
        
        agentIdentities[tokenId] = identity;
        agentToTokenId[agentAddress] = tokenId;
        totalAgents++;
        
        emit AgentRegistered(tokenId, agentAddress, name);
        return tokenId;
    }
    
    /**
     * @notice Verify an agent (only owner)
     * @param tokenId The agent's token ID
     * @param status Verification status
     */
    function verifyAgent(uint256 tokenId, bool status) external onlyOwner {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        
        agentIdentities[tokenId].verified = status;
        
        if (status) {
            verifiedAgents++;
        } else if (agentIdentities[tokenId].verified && !status) {
            verifiedAgents--;
        }
        
        emit AgentVerified(tokenId, status);
    }
    
    /**
     * @notice Deactivate an agent (only owner)
     * @param tokenId The agent's token ID
     */
    function deactivateAgent(uint256 tokenId) external onlyOwner {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        
        agentIdentities[tokenId].isActive = false;
        emit AgentDeactivated(tokenId);
    }
    
    /**
     * @notice Reactivate an agent (only owner)
     * @param tokenId The agent's token ID
     */
    function reactivateAgent(uint256 tokenId) external onlyOwner {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        
        agentIdentities[tokenId].isActive = true;
        emit AgentReactivated(tokenId);
    }
    
    /**
     * @notice Get agent identity by token ID
     * @param tokenId The token ID
     * @return identity The agent identity
     */
    function getAgentIdentity(uint256 tokenId) external view returns (AgentIdentity memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        return agentIdentities[tokenId];
    }
    
    /**
     * @notice Get agent identity by agent address
     * @param agentAddress The agent's address
     * @return identity The agent identity
     */
    function getAgentIdentityByAddress(address agentAddress) external view returns (AgentIdentity memory) {
        uint256 tokenId = agentToTokenId[agentAddress];
        require(tokenId != 0, "Agent not registered");
        return agentIdentities[tokenId];
    }
    
    /**
     * @notice Get token ID for an agent address
     * @param agentAddress The agent's address
     * @return tokenId The token ID
     */
    function getTokenId(address agentAddress) external view returns (uint256) {
        return agentToTokenId[agentAddress];
    }
    
    /**
     * @notice Check if an agent is registered (by address)
     * @param agentAddress The agent's address
     * @return registered Whether the agent is registered
     */
    function isRegistered(address agentAddress) external view returns (bool) {
        return agentToTokenId[agentAddress] != 0;
    }

    /**
     * @notice Check if an agent is registered and active
     * @param agentAddress The agent's address
     * @return valid Whether the agent is valid
     */
    function isAgentValid(address agentAddress) external view returns (bool) {
        uint256 tokenId = agentToTokenId[agentAddress];
        return tokenId != 0 && agentIdentities[tokenId].isActive;
    }
    
    /**
     * @notice Check if an agent is verified
     * @param agentAddress The agent's address
     * @return verified Whether the agent is verified
     */
    function isAgentVerified(address agentAddress) external view returns (bool) {
        uint256 tokenId = agentToTokenId[agentAddress];
        return tokenId != 0 && agentIdentities[tokenId].verified;
    }
    
    /**
     * @notice Set the AgentGuardian contract address
     * @param _agentGuardian The AgentGuardian contract address
     */
    function setAgentGuardian(address _agentGuardian) external onlyOwner {
        agentGuardian = _agentGuardian;
    }

    /**
     * @notice Set the UnderwriterDAO contract address
     * @param _underwriterDAO The UnderwriterDAO contract address
     */
    function setUnderwriterDAO(address _underwriterDAO) external onlyOwner {
        underwriterDAO = _underwriterDAO;
        authorizedCallers[_underwriterDAO] = true;
    }

    /**
     * @notice Update agent reputation (only authorized callers)
     * @param agentAddress The agent's address
     * @param newReputation The new reputation score
     */
    function updateReputation(address agentAddress, uint256 newReputation) external onlyAuthorized {
        uint256 tokenId = agentToTokenId[agentAddress];
        require(tokenId != 0, "Agent not registered");
        
        agentIdentities[tokenId].reputation = newReputation;
        emit ReputationUpdated(tokenId, newReputation);
    }

    /**
     * @notice Update agent reputation by delta (only authorized callers)
     * @param agentAddress The agent's address
     * @param delta The reputation delta to apply
     * @param positive Whether to add (true) or subtract (false) the delta
     */
    function updateReputation(address agentAddress, uint256 delta, bool positive) external onlyAuthorized {
        uint256 tokenId = agentToTokenId[agentAddress];
        require(tokenId != 0, "Agent not registered");
        
        uint256 currentReputation = agentIdentities[tokenId].reputation;
        uint256 newReputation = positive 
            ? currentReputation + delta 
            : (currentReputation > delta ? currentReputation - delta : 0);
        
        agentIdentities[tokenId].reputation = newReputation;
        emit ReputationUpdated(tokenId, newReputation);
    }
    
    /**
     * @notice Generate token URI with metadata
     * @param tokenId The token ID
     * @return uri The token URI
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        
        AgentIdentity memory identity = agentIdentities[tokenId];
        
        string memory json = string(abi.encodePacked(
            '{"name": "', identity.name, '",',
            '"description": "', identity.description, '",',
            '"image": "https://via.placeholder.com/200",',
            '"attributes": [',
            '{"trait_type": "Capabilities", "value": "', identity.capabilities, '"},',
            '{"trait_type": "Reputation", "value": ', Strings.toString(identity.reputation), '},',
            '{"trait_type": "Verified", "value": ', identity.verified ? 'true' : 'false', '},',
            '{"trait_type": "Active", "value": ', identity.isActive ? 'true' : 'false', '},',
            '{"trait_type": "Creation Date", "display_type": "date", "value": ', Strings.toString(identity.creationTime), '}',
            ']}'
        ));
        
        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        ));
    }
    
    /**
     * @notice Get all token IDs for an owner
     * @param owner The owner address
     * @return tokenIds Array of token IDs owned by the address
     */
    function getTokensByOwner(address owner) external view returns (uint256[] memory) {
        uint256 balance = balanceOf(owner);
        uint256[] memory tokenIds = new uint256[](balance);
        
        for (uint256 i = 0; i < balance; i++) {
            tokenIds[i] = tokenOfOwnerByIndex(owner, i);
        }
        
        return tokenIds;
    }
}

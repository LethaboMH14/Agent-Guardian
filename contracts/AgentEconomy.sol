// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/**
 * @title AgentEconomy
 * @dev Monetization Strategy Expansion - Service Marketplace for Agents
 */
contract AgentEconomy {
    struct ServiceListing {
        address provider;
        string serviceType;
        uint256 price;
        uint256 minReputation;
        bool active;
    }
    
    mapping(string => ServiceListing[]) public serviceMarketplace;
    mapping(address => uint256) public agentEarnings;
    mapping(address => uint256) public agentReputation;
    
    address public owner;
    
    event ServiceListed(address indexed provider, string serviceType, uint256 price, uint256 minReputation);
    event ServicePurchased(address indexed buyer, address indexed provider, string serviceType, uint256 price);
    event ServiceDelisted(uint256 serviceIndex, string serviceType);
    event EarningsWithdrawn(address indexed agent, uint256 amount);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    /**
     * @dev List a service in the marketplace
     */
    function listService(
        string calldata serviceType,
        uint256 price,
        uint256 minReputation
    ) external {
        serviceMarketplace[serviceType].push(ServiceListing({
            provider: msg.sender,
            serviceType: serviceType,
            price: price,
            minReputation: minReputation,
            active: true
        }));
        
        emit ServiceListed(msg.sender, serviceType, price, minReputation);
    }
    
    /**
     * @dev Purchase a service from the marketplace
     */
    function purchaseService(string calldata serviceType, address provider) external payable {
        ServiceListing[] storage listings = serviceMarketplace[serviceType];
        
        for (uint256 i = 0; i < listings.length; i++) {
            if (listings[i].provider == provider && listings[i].active) {
                require(msg.value >= listings[i].price, "Insufficient payment");
                require(agentReputation[msg.sender] >= listings[i].minReputation, "Reputation too low");
                
                agentEarnings[provider] += msg.value;
                
                emit ServicePurchased(msg.sender, provider, serviceType, msg.value);
                return;
            }
        }
        
        revert("Service not found");
    }
    
    /**
     * @dev Delist a service
     */
    function delistService(string calldata serviceType, uint256 index) external {
        require(index < serviceMarketplace[serviceType].length, "Invalid index");
        require(serviceMarketplace[serviceType][index].provider == msg.sender, "Not your service");
        
        serviceMarketplace[serviceType][index].active = false;
        
        emit ServiceDelisted(index, serviceType);
    }
    
    /**
     * @dev Withdraw earnings
     */
    function withdrawEarnings(uint256 amount) external {
        require(agentEarnings[msg.sender] >= amount, "Insufficient earnings");
        
        agentEarnings[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
        
        emit EarningsWithdrawn(msg.sender, amount);
    }
    
    /**
     * @dev Set agent reputation (called by AgentGuardian)
     */
    function setAgentReputation(address agent, uint256 reputation) external onlyOwner {
        agentReputation[agent] = reputation;
    }
    
    /**
     * @dev Get all listings for a service type
     */
    function getServiceListings(string calldata serviceType) external view returns (ServiceListing[] memory) {
        return serviceMarketplace[serviceType];
    }
    
    /**
     * @dev Get agent earnings
     */
    function getAgentEarnings(address agent) external view returns (uint256) {
        return agentEarnings[agent];
    }
    
    /**
     * @dev Get agent reputation
     */
    function getAgentReputation(address agent) external view returns (uint256) {
        return agentReputation[agent];
    }
    
    /**
     * @dev Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }
    
    /**
     * @dev Receive ETH
     */
    receive() external payable {}
}

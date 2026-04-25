const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Guardian Nexus: Full Lifecycle Validation", function () {
    let guardian: any, reputationSystem: any, insurancePool: any, rAGNT: any, verifier: any;
    let owner: any, agent: any, staker: any;

    before(async function () {
        [owner, agent, staker] = await ethers.getSigners();
        
        // Deployments
        const ReputationToken = await ethers.getContractFactory("ReputationToken");
        rAGNT = await ReputationToken.deploy();
        
        const ReputationSystem = await ethers.getContractFactory("ReputationSystem");
        reputationSystem = await ReputationSystem.deploy(await rAGNT.getAddress());

        // Transfer ownership of rAGNT to ReputationSystem so it can mint
        await rAGNT.transferOwnership(await reputationSystem.getAddress());
        
        const CognitionVerifier = await ethers.getContractFactory("MockCognitionVerifier");
        verifier = await CognitionVerifier.deploy();
        
        const InsurancePool = await ethers.getContractFactory("InsurancePool");
        insurancePool = await InsurancePool.deploy(ethers.ZeroAddress); // Mock USDC
        
        const AgentGuardian = await ethers.getContractFactory("AgentGuardian");
        guardian = await AgentGuardian.deploy(
            ethers.ZeroAddress, 
            ethers.ZeroAddress, 
            await verifier.getAddress(), 
            await insurancePool.getAddress(), 
            owner.address
        );
    });

    describe("Phase 1: Reputation & Collateralization", function () {
        it("Should mint rAGNT tokens on agent initialization", async function () {
            await reputationSystem.initializeAgent(agent.address);
            const balance = await rAGNT.balanceOf(agent.address);
            expect(balance).to.equal(500n * 10n**18n); // Default 500 score
        });
    });

    describe("Phase 2: ZK-ML Proof-of-Cognition", function () {
        it("Should reject transaction without valid ZK-proof", async function () {
            // MockVerifier returns true, but we should test failure scenario
            // logic would require a MockVerifier.setValid(false)
        });
    });

    describe("Phase 3: Insurance & Slashing", function () {
        it("Should slash agent and deactivate on policy violation", async function () {
            // Updated registration with correct parameters: (address, maxDaily, approvedRecipients, humanApproval, minScore)
            await guardian.registerAgent(agent.address, 1000, [], false, 100);
            await guardian.slashRogueAgent(agent.address);
            const policy = await guardian.getAgentPolicy(agent.address);
            expect(policy.isActive).to.be.false;
        });
    });
});

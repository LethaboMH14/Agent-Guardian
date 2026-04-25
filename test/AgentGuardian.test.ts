import { expect } from "chai";
import hre from "hardhat";
import { AgentGuardian, MockUSDC, AgentRegistry } from "../typechain-types";

// @ts-ignore - Hardhat 2 provides ethers but types don't recognize it
const { ethers } = hre as any;

describe("AgentGuardian", function () {
  let agentGuardian: AgentGuardian;
  let agentRegistry: AgentRegistry;
  let usdc: MockUSDC;
  let owner: any;
  let agent: any;
  let recipient: any;
  let other: any;

  const USDC_DECIMALS = 6;
  const INITIAL_SUPPLY = ethers.parseUnits("1000000", USDC_DECIMALS);

  beforeEach(async function () {
    [owner, agent, recipient, other] = await ethers.getSigners();

    // Deploy mock USDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy(INITIAL_SUPPLY) as MockUSDC;

    // Deploy AgentRegistry (requires guardian address, use owner temporarily)
    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    agentRegistry = await AgentRegistry.deploy(owner.address) as AgentRegistry;

    // Deploy AgentGuardian (requires registry address)
    const AgentGuardian = await ethers.getContractFactory("AgentGuardian");
    agentGuardian = await AgentGuardian.deploy(
      await usdc.getAddress(),
      await agentRegistry.getAddress()
    ) as AgentGuardian;

    // Set up integration
    await agentRegistry.setAgentGuardian(await agentGuardian.getAddress());

    // Fund agent with USDC
    await usdc.transfer(agent.address, ethers.parseUnits("1000", USDC_DECIMALS));
    await usdc.connect(agent).approve(await agentGuardian.getAddress(), ethers.parseUnits("1000", USDC_DECIMALS));
  });

  describe("Deployment", function () {
    it("Should set the correct USDC token address", async function () {
      expect(await agentGuardian.USDC_TOKEN()).to.equal(await usdc.getAddress());
    });

    it("Should set the owner correctly", async function () {
      expect(await agentGuardian.owner()).to.equal(owner.address);
    });
  });

  describe("Agent Registration", function () {
    it("Should register a new agent", async function () {
      const maxDailySpend = ethers.parseUnits("100", USDC_DECIMALS);
      const approvedRecipients = [recipient.address];
      const requiresHumanApproval = false;
      const minReputationScore = 500;

      await expect(
        agentGuardian.registerAgent(
          agent.address,
          maxDailySpend,
          approvedRecipients,
          requiresHumanApproval,
          minReputationScore
        )
      )
        // @ts-ignore - TypeScript doesn't recognize chai matcher types
        .to.emit(agentGuardian, "AgentRegistered")
        // @ts-ignore - TypeScript doesn't recognize chai matcher types
        .withArgs(agent.address, owner.address);

      const policy = await agentGuardian.agentPolicies(agent.address);
      expect(policy.owner).to.equal(owner.address);
      expect(policy.maxDailySpend).to.equal(maxDailySpend);
      expect(policy.isActive).to.be.true;
    });

    it("Should not register an already registered agent", async function () {
      const maxDailySpend = ethers.parseUnits("100", USDC_DECIMALS);
      
      await agentGuardian.registerAgent(
        agent.address,
        maxDailySpend,
        [recipient.address],
        false,
        500
      );

      // @ts-ignore - TypeScript doesn't recognize chai matcher types
      await expect(
        agentGuardian.registerAgent(
          agent.address,
          maxDailySpend,
          [recipient.address],
          false,
          500
        )
      ).to.be.revertedWithCustomError(agentGuardian, "AgentAlreadyRegistered");
    });

    it("Should set initial reputation to 500", async function () {
      await agentGuardian.registerAgent(
        agent.address,
        ethers.parseUnits("100", USDC_DECIMALS),
        [recipient.address],
        false,
        500
      );

      expect(await agentGuardian.agentReputation(agent.address)).to.equal(500);
    });

    it("Should set default spending limits", async function () {
      const maxDailySpend = ethers.parseUnits("100", USDC_DECIMALS);
      
      await agentGuardian.registerAgent(
        agent.address,
        maxDailySpend,
        [recipient.address],
        false,
        500
      );

      const limits = await agentGuardian.spendingLimits(agent.address);
      expect(limits.perTransaction).to.equal(ethers.parseUnits("10", USDC_DECIMALS));
      expect(limits.daily).to.equal(maxDailySpend);
      expect(limits.weekly).to.equal(ethers.parseUnits("700", USDC_DECIMALS));
    });
  });

  describe("Transaction Validation", function () {
    beforeEach(async function () {
      await agentGuardian.registerAgent(
        agent.address,
        ethers.parseUnits("100", USDC_DECIMALS),
        [recipient.address],
        false,
        500
      );
    });

    it("Should validate a transaction within limits", async function () {
      const amount = ethers.parseUnits("5", USDC_DECIMALS);
      
      const tx = await agentGuardian.validateTransaction.staticCall(
        agent.address,
        recipient.address,
        amount
      );
      const approved = tx[0];
      const approvalId = tx[1];

      expect(approved).to.be.true;
      expect(approvalId).to.equal(ethers.ZeroHash);
    });

    it("Should reject transaction to unapproved recipient", async function () {
      const amount = ethers.parseUnits("5", USDC_DECIMALS);
      
      const tx = await agentGuardian.validateTransaction.staticCall(
        agent.address,
        other.address,
        amount
      );
      const approved = tx[0];

      expect(approved).to.be.false;
    });

    it("Should reject transaction exceeding per-transaction limit", async function () {
      const amount = ethers.parseUnits("15", USDC_DECIMALS); // Exceeds 10 USDC limit
      
      const tx = await agentGuardian.validateTransaction.staticCall(
        agent.address,
        recipient.address,
        amount
      );
      const approved = tx[0];

      expect(approved).to.be.false;
    });

    it("Should reject transaction exceeding daily limit", async function () {
      // First transaction
      await agentGuardian.validateTransaction.staticCall(
        agent.address,
        recipient.address,
        ethers.parseUnits("60", USDC_DECIMALS)
      );

      // Second transaction should exceed daily limit
      const tx = await agentGuardian.validateTransaction.staticCall(
        agent.address,
        recipient.address,
        ethers.parseUnits("50", USDC_DECIMALS)
      );
      const approved = tx[0];

      expect(approved).to.be.false;
    });

    it("Should reject transaction for inactive agent", async function () {
      await agentGuardian.deactivateAgent(agent.address);

      // @ts-ignore - TypeScript doesn't recognize chai matcher types
      await expect(
        agentGuardian.validateTransaction.staticCall(
          agent.address,
          recipient.address,
          ethers.parseUnits("5", USDC_DECIMALS)
        )
      ).to.be.revertedWithCustomError(agentGuardian, "AgentNotActive");
    });

    it("Should require human approval for large transactions when configured", async function () {
      // Update policy to require human approval
      await agentGuardian.updateAgentPolicy(
        agent.address,
        ethers.parseUnits("1000", USDC_DECIMALS), // High daily limit
        [recipient.address],
        true,
        500
      );
      
      // Set spending limits
      await agentGuardian.updateSpendingLimits(
        agent.address,
        ethers.parseUnits("100", USDC_DECIMALS),
        ethers.parseUnits("1000", USDC_DECIMALS),
        ethers.parseUnits("5000", USDC_DECIMALS)
      );

      const amount = ethers.parseUnits("15", USDC_DECIMALS);
      
      const tx = await agentGuardian.validateTransaction.staticCall(
        agent.address,
        recipient.address,
        amount
      );
      const approved = tx[0];
      const approvalId = tx[1];

      // Should require human approval when configured
      expect(approved).to.be.false;
      expect(approvalId).to.not.equal(ethers.ZeroHash);
    });

    it("Should reset daily spending after 1 day", async function () {
      // Spend up to limit by executing transactions
      const amount = ethers.parseUnits("10", USDC_DECIMALS);
      for (let i = 0; i < 10; i++) {
        await agentGuardian.validateTransaction(agent.address, recipient.address, amount);
        await agentGuardian.executeTransaction(agent.address, recipient.address, amount, ethers.ZeroHash);
      }

      // Should be rejected (daily limit reached)
      const tx = await agentGuardian.validateTransaction.staticCall(
        agent.address,
        recipient.address,
        ethers.parseUnits("1", USDC_DECIMALS)
      );
      const approved = tx[0];
      expect(approved).to.be.false;

      // Fast forward 1 day
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      // Should be approved again (daily reset)
      const tx2 = await agentGuardian.validateTransaction.staticCall(
        agent.address,
        recipient.address,
        ethers.parseUnits("1", USDC_DECIMALS)
      );
      const approved2 = tx2[0];
      expect(approved2).to.be.true;
    });
  });

  describe("Transaction Execution", function () {
    beforeEach(async function () {
      await agentGuardian.registerAgent(
        agent.address,
        ethers.parseUnits("100", USDC_DECIMALS),
        [recipient.address],
        false,
        500
      );
    });

    it("Should execute an approved transaction", async function () {
      const amount = ethers.parseUnits("5", USDC_DECIMALS);
      
      await agentGuardian.validateTransaction(agent.address, recipient.address, amount);
      
      await expect(
        agentGuardian.executeTransaction(agent.address, recipient.address, amount, ethers.ZeroHash)
      )
        // @ts-ignore - TypeScript doesn't recognize chai matcher types
        .to.emit(agentGuardian, "TransactionExecuted")
        // @ts-ignore - TypeScript doesn't recognize chai matcher types
        .withArgs(agent.address, recipient.address, amount);

      expect(await usdc.balanceOf(recipient.address)).to.equal(amount);
    });

    it("Should increase reputation after successful transaction", async function () {
      const amount = ethers.parseUnits("5", USDC_DECIMALS);
      
      await agentGuardian.validateTransaction(agent.address, recipient.address, amount);
      await agentGuardian.executeTransaction(agent.address, recipient.address, amount, ethers.ZeroHash);

      expect(await agentGuardian.agentReputation(agent.address)).to.equal(510);
    });

    it("Should only allow owner to execute transaction", async function () {
      const amount = ethers.parseUnits("5", USDC_DECIMALS);
      
      await agentGuardian.validateTransaction(agent.address, recipient.address, amount);
      
      // @ts-ignore - TypeScript doesn't recognize chai matcher types
      await expect(
        agentGuardian.connect(other).executeTransaction(agent.address, recipient.address, amount, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(agentGuardian, "Unauthorized");
    });

    it("Should execute transaction with human approval", async function () {
      await agentGuardian.updateAgentPolicy(
        agent.address,
        ethers.parseUnits("100", USDC_DECIMALS),
        [recipient.address],
        true,
        500
      );

      const amount = ethers.parseUnits("15", USDC_DECIMALS);
      
      const tx = await agentGuardian.validateTransaction.staticCall(
        agent.address,
        recipient.address,
        amount
      );
      const approved = tx[0];
      const approvalId = tx[1];

      await agentGuardian.executeTransaction(agent.address, recipient.address, amount, approvalId);

      expect(await usdc.balanceOf(recipient.address)).to.equal(amount);
    });
  });

  describe("Reputation Management", function () {
    beforeEach(async function () {
      await agentGuardian.registerAgent(
        agent.address,
        ethers.parseUnits("100", USDC_DECIMALS),
        [recipient.address],
        false,
        500
      );
    });

    it("Should increase reputation", async function () {
      await agentGuardian.updateReputation(agent.address, 50, true);
      expect(await agentGuardian.agentReputation(agent.address)).to.equal(550);
    });

    it("Should decrease reputation", async function () {
      await agentGuardian.updateReputation(agent.address, 50, false);
      expect(await agentGuardian.agentReputation(agent.address)).to.equal(450);
    });

    it("Should cap reputation at maximum", async function () {
      await agentGuardian.updateReputation(agent.address, 1000, true);
      expect(await agentGuardian.agentReputation(agent.address)).to.equal(1000);
    });

    it("Should floor reputation at minimum", async function () {
      await agentGuardian.updateReputation(agent.address, 1000, false);
      expect(await agentGuardian.agentReputation(agent.address)).to.equal(0);
    });

    it("Should only allow owner to update reputation", async function () {
      await expect(
        agentGuardian.connect(other).updateReputation(agent.address, 50, true)
      ).to.be.revertedWithCustomError(agentGuardian, "OwnableUnauthorizedAccount");
    });
  });

  describe("Spending Limits", function () {
    beforeEach(async function () {
      await agentGuardian.registerAgent(
        agent.address,
        ethers.parseUnits("100", USDC_DECIMALS),
        [recipient.address],
        false,
        500
      );
    });

    it("Should update spending limits", async function () {
      await agentGuardian.updateSpendingLimits(
        agent.address,
        ethers.parseUnits("20", USDC_DECIMALS),
        ethers.parseUnits("200", USDC_DECIMALS),
        ethers.parseUnits("1000", USDC_DECIMALS)
      );

      const limits = await agentGuardian.spendingLimits(agent.address);
      expect(limits.perTransaction).to.equal(ethers.parseUnits("20", USDC_DECIMALS));
      expect(limits.daily).to.equal(ethers.parseUnits("200", USDC_DECIMALS));
      expect(limits.weekly).to.equal(ethers.parseUnits("1000", USDC_DECIMALS));
    });

    it("Should enforce weekly limits", async function () {
      await agentGuardian.updateSpendingLimits(
        agent.address,
        ethers.parseUnits("10", USDC_DECIMALS),
        ethers.parseUnits("100", USDC_DECIMALS),
        ethers.parseUnits("50", USDC_DECIMALS)
      );

      // Execute transactions to spend up to weekly limit
      const amount = ethers.parseUnits("10", USDC_DECIMALS);
      for (let i = 0; i < 5; i++) {
        await agentGuardian.validateTransaction(agent.address, recipient.address, amount);
        await agentGuardian.executeTransaction(agent.address, recipient.address, amount, ethers.ZeroHash);
      }

      // Should be rejected (weekly limit exceeded)
      const tx = await agentGuardian.validateTransaction.staticCall(
        agent.address,
        recipient.address,
        ethers.parseUnits("10", USDC_DECIMALS)
      );
      const approved = tx[0];
      expect(approved).to.be.false;
    });
  });

  describe("Policy Management", function () {
    beforeEach(async function () {
      await agentGuardian.registerAgent(
        agent.address,
        ethers.parseUnits("100", USDC_DECIMALS),
        [recipient.address],
        false,
        500
      );
    });

    it("Should update agent policy", async function () {
      await agentGuardian.updateAgentPolicy(
        agent.address,
        ethers.parseUnits("200", USDC_DECIMALS),
        [recipient.address, other.address],
        true,
        600
      );

      const policy = await agentGuardian.agentPolicies(agent.address);
      expect(policy.maxDailySpend).to.equal(ethers.parseUnits("200", USDC_DECIMALS));
      expect(policy.requiresHumanApproval).to.be.true;
      expect(policy.minReputationScore).to.equal(600);
    });

    it("Should deactivate agent", async function () {
      await agentGuardian.deactivateAgent(agent.address);
      
      const policy = await agentGuardian.agentPolicies(agent.address);
      expect(policy.isActive).to.be.false;
    });

    it("Should reactivate agent", async function () {
      await agentGuardian.deactivateAgent(agent.address);
      await agentGuardian.reactivateAgent(agent.address);
      
      const policy = await agentGuardian.agentPolicies(agent.address);
      expect(policy.isActive).to.be.true;
    });
  });

  describe("Transaction Cost Calculation", function () {
    it("Should calculate base cost", async function () {
      const cost = await agentGuardian.calculateTransactionCost(1);
      expect(cost).to.equal(1700); // 1600 + 100
    });

    it("Should calculate cost with complexity", async function () {
      const cost = await agentGuardian.calculateTransactionCost(5);
      expect(cost).to.equal(2100); // 1600 + 500
    });
  });

  describe("Getter Functions", function () {
    beforeEach(async function () {
      await agentGuardian.registerAgent(
        agent.address,
        ethers.parseUnits("100", USDC_DECIMALS),
        [recipient.address],
        false,
        500
      );
    });

    it("Should return agent policy", async function () {
      const policy = await agentGuardian.getAgentPolicy(agent.address);
      expect(policy.owner).to.equal(owner.address);
      expect(policy.isActive).to.be.true;
    });

    it("Should return spending limits", async function () {
      const limits = await agentGuardian.getSpendingLimits(agent.address);
      expect(limits.perTransaction).to.equal(ethers.parseUnits("10", USDC_DECIMALS));
    });
  });
});

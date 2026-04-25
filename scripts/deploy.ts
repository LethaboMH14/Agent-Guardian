import hre from "hardhat";

// @ts-ignore - Hardhat 2 provides ethers but types don't recognize it
const { ethers } = hre as any;

async function main() {
  console.log("Deploying AgentGuardian contracts...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Deploy MockUSDC for testing (skip on mainnet)
  const usdcAddress = process.env.USDC_TOKEN_ADDRESS;
  let usdc;
  
  if (!usdcAddress) {
    console.log("No USDC address provided, deploying MockUSDC...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy(ethers.parseUnits("1000000", 6));
    await usdc.waitForDeployment();
    console.log("MockUSDC deployed to:", await usdc.getAddress());
  } else {
    console.log("Using existing USDC at:", usdcAddress);
  }

  // Deploy AgentRegistry (requires guardian address, use deployer temporarily)
  console.log("Deploying AgentRegistry...");
  const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
  const agentRegistry = await AgentRegistry.deploy(deployer.address);
  await agentRegistry.waitForDeployment();
  console.log("AgentRegistry deployed to:", await agentRegistry.getAddress());

  // Deploy PolicyManager
  console.log("Deploying PolicyManager...");
  const PolicyManager = await ethers.getContractFactory("PolicyManager");
  const policyManager = await PolicyManager.deploy();
  await policyManager.waitForDeployment();
  console.log("PolicyManager deployed to:", await policyManager.getAddress());

  // Deploy ReputationSystem
  console.log("Deploying ReputationSystem...");
  const ReputationSystem = await ethers.getContractFactory("ReputationSystem");
  const reputationSystem = await ReputationSystem.deploy();
  await reputationSystem.waitForDeployment();
  console.log("ReputationSystem deployed to:", await reputationSystem.getAddress());

  // Deploy AgentGuardian (requires registry address)
  console.log("Deploying AgentGuardian...");
  const usdcTokenAddress = usdcAddress || await usdc.getAddress();
  const AgentGuardian = await ethers.getContractFactory("AgentGuardian");
  const agentGuardian = await AgentGuardian.deploy(
    usdcTokenAddress,
    await agentRegistry.getAddress()
  );
  await agentGuardian.waitForDeployment();
  console.log("AgentGuardian deployed to:", await agentGuardian.getAddress());

  // Set up integrations
  console.log("Setting up integrations...");
  await agentRegistry.setAgentGuardian(await agentGuardian.getAddress());
  await policyManager.setAgentGuardian(await agentGuardian.getAddress());
  await reputationSystem.setAgentGuardian(await agentGuardian.getAddress());
  console.log("Integrations set up successfully");

  console.log("\n=== Deployment Summary ===");
  console.log("USDC:", usdcTokenAddress);
  console.log("AgentRegistry:", await agentRegistry.getAddress());
  console.log("PolicyManager:", await policyManager.getAddress());
  console.log("ReputationSystem:", await reputationSystem.getAddress());
  console.log("AgentGuardian:", await agentGuardian.getAddress());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

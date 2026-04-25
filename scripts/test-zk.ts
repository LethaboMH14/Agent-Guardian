#!/usr/bin/env node
/**
 * Test script for ZK-ML proof verification
 * Registers an agent with commitment and validates a transaction
 */

import pkg from "hardhat";
const { ethers } = pkg;
import * as fs from "fs";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Testing with account:", deployer.address);

    // Load deployment addresses
    const deploymentFile = "deployment/localhost-31337.json";
    const addresses = JSON.parse(fs.readFileSync(deploymentFile, "utf-8"));

    // Get contract instances
    const agentRegistry = await ethers.getContractAt("AgentRegistry", addresses.AgentRegistry);
    const cognitionVerifier = await ethers.getContractAt("CognitionVerifier", addresses.CognitionVerifier);
    const agentGuardian = await ethers.getContractAt("AgentGuardian", addresses.AgentGuardian);

    // Load proof data
    const proofFile = "circuits/proofs/tx_payload_1776806073451.json";
    const { proofData, publicInputs } = JSON.parse(fs.readFileSync(proofFile, "utf-8"));

    const commitment = publicInputs[1];
    console.log("\nCommitment:", commitment);

    // Step 1: Register agent in AgentRegistry
    console.log("\n[1] Registering agent in AgentRegistry...");
    const tx1 = await agentRegistry.registerAgent(
        "TestAgent",
        "AI agent for ZK-ML testing",
        "ML inference, data processing",
        deployer.address
    );
    await tx1.wait();
    console.log("✓ Agent registered");

    // Step 2: Set commitment via CognitionVerifier (using ownerRegisterCommitment for testing)
    console.log("\n[2] Setting commitment in CognitionVerifier...");
    const tx2 = await cognitionVerifier.ownerRegisterCommitment(deployer.address, commitment);
    await tx2.wait();
    console.log("✓ Commitment set");

    // Step 3: Verify the proof directly
    console.log("\n[3] Verifying proof...");
    const valid = await cognitionVerifier.verify(proofData, publicInputs);
    console.log("Proof valid:", valid);

    if (valid) {
        console.log("\n✅ ZK-ML verification successful!");
        console.log("   - Agent:", deployer.address);
        console.log("   - Decision Hash:", publicInputs[0]);
        console.log("   - Commitment:", commitment);
    }
}

main().catch(console.error);

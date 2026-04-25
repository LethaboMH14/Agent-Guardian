/**
 * deploy-layer6c.ts — Layer 6C deployment script
 *
 * Deploys CrossChainIdentity.sol to Arc + registers peers on all destination chains.
 * Run: npx hardhat run scripts/deploy-layer6c.ts --network arcTestnet
 *
 * Post-deploy checklist:
 *   1. Set CROSS_CHAIN_IDENTITY_ARC in .env
 *   2. Deploy same contract to Ethereum/Arbitrum/Base, set their env vars
 *   3. Call registerPeer() on each chain pointing to the others
 *   4. Add council member addresses
 *   5. Fund Arc contract with ~0.1 ETH for unfreeze propagation gas
 *   6. Start sentinel: npx tsx src/crosschain/sentinel.ts
 */

import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

// LayerZero V2 Endpoint addresses per chain (immutable, from LZ docs)
const LZ_ENDPOINTS: Record<string, string> = {
  arcTestnet:  process.env.LZ_ENDPOINT_ARC   || "0x0000000000000000000000000000000000000000",
  ethereum:    "0x1a44076050125825900e736c501f859c50fE728c",
  arbitrum:    "0x1a44076050125825900e736c501f859c50fE728c",
  base:        "0x1a44076050125825900e736c501f859c50fE728c",
  polygon:     "0x1a44076050125825900e736c501f859c50fE728c",
};

// LayerZero V2 EIDs
const EIDS: Record<string, number> = {
  ethereum: 30101,
  arbitrum: 30110,
  base:     30184,
  polygon:  30109,
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = (await ethers.provider.getNetwork()).name;

  console.log("═══════════════════════════════════════════════════");
  console.log("  AgentGuardian Layer 6C — CrossChainIdentity Deploy");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Network:  ${network}`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log("");

  // ── Read existing contract addresses ──────────────────────────────────────

  const agentRegistryAddr   = process.env.AGENT_REGISTRY_ADDRESS;
  const insurancePoolAddr   = process.env.INSURANCE_POOL_ADDRESS;
  const cognitionVerAddr    = process.env.COGNITION_VERIFIER_ADDRESS;
  const lzEndpointAddr      = LZ_ENDPOINTS[network] || LZ_ENDPOINTS.arcTestnet;

  if (!agentRegistryAddr) throw new Error("AGENT_REGISTRY_ADDRESS not set in .env");
  if (!insurancePoolAddr) throw new Error("INSURANCE_POOL_ADDRESS not set in .env");
  if (!cognitionVerAddr)  throw new Error("COGNITION_VERIFIER_ADDRESS not set in .env");

  console.log("  Dependencies:");
  console.log(`    AgentRegistry:      ${agentRegistryAddr}`);
  console.log(`    InsurancePool:      ${insurancePoolAddr}`);
  console.log(`    CognitionVerifier:  ${cognitionVerAddr}`);
  console.log(`    LZ Endpoint V2:     ${lzEndpointAddr}`);
  console.log("");

  // ── Deploy CrossChainIdentity ──────────────────────────────────────────────

  console.log("  Deploying CrossChainIdentity...");
  const CrossChainIdentity = await ethers.getContractFactory("CrossChainIdentity");

  const crossChainId = await CrossChainIdentity.deploy(
    lzEndpointAddr,
    agentRegistryAddr,
    insurancePoolAddr,
    cognitionVerAddr,
    deployer.address,
    { gasLimit: 3_000_000 }
  );

  await crossChainId.waitForDeployment();
  const crossChainAddr = await crossChainId.getAddress();
  console.log(`  ✅ CrossChainIdentity deployed: ${crossChainAddr}`);

  // ── Register council members ───────────────────────────────────────────────

  const councilAddresses = (process.env.COUNCIL_ADDRESSES || "").split(",").filter(Boolean);
  if (councilAddresses.length > 0) {
    console.log("\n  Registering council members...");
    for (const addr of councilAddresses) {
      const trimmed = addr.trim();
      await crossChainId.addCouncilMember(trimmed, { gasLimit: 100_000 });
      console.log(`    ✅ Council: ${trimmed}`);
    }
  } else {
    console.log("\n  ⚠️  No COUNCIL_ADDRESSES set — add council members manually");
  }

  // ── Register peers (if peer addresses known) ──────────────────────────────

  console.log("\n  Registering peer chains...");

  const peers: Array<{ eid: number; addr: string | undefined; name: string }> = [
    { eid: EIDS.ethereum, addr: process.env.CROSS_CHAIN_IDENTITY_ETH, name: "Ethereum" },
    { eid: EIDS.arbitrum, addr: process.env.CROSS_CHAIN_IDENTITY_ARB, name: "Arbitrum" },
    { eid: EIDS.base,     addr: process.env.CROSS_CHAIN_IDENTITY_BASE, name: "Base" },
    { eid: EIDS.polygon,  addr: process.env.CROSS_CHAIN_IDENTITY_POLYGON, name: "Polygon" },
  ];

  let peersRegistered = 0;
  for (const peer of peers) {
    if (peer.addr) {
      const peerBytes32 = ethers.zeroPadValue(peer.addr, 32);
      await crossChainId.registerPeer(peer.eid, peerBytes32, { gasLimit: 150_000 });
      console.log(`    ✅ Peer registered: ${peer.name} (EID ${peer.eid}) → ${peer.addr}`);
      peersRegistered++;
    } else {
      console.log(`    ⏳ ${peer.name} (EID ${peer.eid}) — deploy there first, then call registerPeer(${peer.eid}, addr)`);
    }
  }

  // ── Fund contract for unfreeze propagation ────────────────────────────────

  const fundAmount = ethers.parseEther("0.05");
  const balance = await ethers.provider.getBalance(deployer.address);

  if (balance > fundAmount + ethers.parseEther("0.01")) {
    console.log("\n  Funding contract for unfreeze gas...");
    const fundTx = await deployer.sendTransaction({
      to: crossChainAddr,
      value: fundAmount,
    });
    await fundTx.wait();
    console.log(`  ✅ Funded: ${ethers.formatEther(fundAmount)} ETH`);
  } else {
    console.log("\n  ⚠️  Low balance — fund contract manually:");
    console.log(`     Send 0.05+ ETH to ${crossChainAddr}`);
  }

  // ── Print summary ──────────────────────────────────────────────────────────

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════════");
  console.log("");
  console.log("  Add to .env:");
  console.log(`  CROSS_CHAIN_IDENTITY_ARC=${crossChainAddr}`);
  console.log("");
  console.log("  Next steps:");
  console.log("  1. Deploy CrossChainIdentity on Ethereum, Arbitrum, Base");
  console.log("  2. Call registerPeer() on each chain with the others' addresses");
  console.log("  3. Configure DVN security stack via LayerZero scan");
  console.log("  4. Run: npx tsx src/crosschain/sentinel.ts");
  console.log("");
  console.log("  Run Supabase SQL schema from sentinel.ts comments");
  console.log("═══════════════════════════════════════════════════");

  return {
    crossChainIdentity: crossChainAddr,
    peersRegistered,
    councilMembers: councilAddresses.length,
    network,
  };
}

main()
  .then((result) => {
    console.log("\nDeploy result:", result);
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nDeploy failed:", err);
    process.exit(1);
  });

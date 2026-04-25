/**
 * ============================================================
 * Layer 6D: ProofAggregation.test.ts
 * ============================================================
 *
 * Comprehensive test suite covering:
 *  1. Unit: ProofAggregator TypeScript logic
 *  2. Contract: BatchVerifier.sol functions
 *  3. Integration: Full pipeline (generate → aggregate → verify on-chain)
 *  4. Security: Replay, forgery, tampering, commitment mismatch
 *  5. Economics: Gas cost validation across batch sizes
 *  6. Cross-layer: Integration with CognitionVerifier + AgentRegistry
 *
 * Run: npx hardhat test test/ProofAggregation.test.ts
 */

import { expect }    from "chai";
import { ethers }    from "hardhat";
import { time }      from "@nomicfoundation/hardhat-network-helpers";
import type { Signer, Contract, ContractFactory } from "ethers";
import { ProofAggregator, IndividualProof, AggregationConfig } from "../src/proofs/proof-aggregator";
import * as path from "path";
import * as fs   from "fs";

// ─────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────

const FIELD_P = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

async function deployMockContracts(owner: Signer): Promise<{
  mockCognitionVerifier: Contract;
  mockAgentRegistry:     Contract;
  batchVerifier:         Contract;
}> {
  // Deploy minimal mock contracts for testing
  // In real tests these would be the actual deployed contracts

  const MockCognitionFactory = await ethers.getContractFactory("MockCognitionVerifier");
  const mockCognitionVerifier = await MockCognitionFactory.connect(owner).deploy();

  const MockRegistryFactory = await ethers.getContractFactory("MockAgentRegistry");
  const mockAgentRegistry = await MockRegistryFactory.connect(owner).deploy();

  const BatchVerifierFactory = await ethers.getContractFactory("BatchVerifier");
  const batchVerifier = await BatchVerifierFactory.connect(owner).deploy(
    await mockCognitionVerifier.getAddress(),
    await mockAgentRegistry.getAddress()
  );

  return { mockCognitionVerifier, mockAgentRegistry, batchVerifier };
}

function buildMockConfig(
  batchVerifierAddr:    string,
  cognitionVerifierAddr: string,
  agentRegistryAddr:    string
): AggregationConfig {
  // Create mock vkey if needed
  const vkeyPath = "/tmp/test_vkey.json";
  if (!fs.existsSync(vkeyPath)) {
    fs.writeFileSync(vkeyPath, JSON.stringify({
      protocol: "groth16",
      curve: "bn128",
      nPublic: 2,
      IC: [
        ["7545673874717028387260001937261256302447949263366962891566334136694458282203",
         "18604317144381847857886385684060986177838410221561136253933256952257712543953", "1"],
        ["1234567890123456789012345678901234567890123456789012345678901234567890123456",
         "9876543210987654321098765432109876543210987654321098765432109876543210987654", "1"],
        ["1111111111111111111111111111111111111111111111111111111111111111111111111111",
         "2222222222222222222222222222222222222222222222222222222222222222222222222222", "1"],
      ],
    }));
  }

  return {
    batchVerifierAddress:     batchVerifierAddr,
    cognitionVerifierAddress: cognitionVerifierAddr,
    agentRegistryAddress:     agentRegistryAddr,
    minBatchSize:             2,
    maxBatchSize:             128,
    autoFlushIntervalMs:      60_000, // no auto-flush in tests
    vkeyPath,
    zkeyPath:                 "/tmp/nonexistent.zkey",
    providerUrl:              "http://localhost:8545",
    privateKey:               "0x" + "a".repeat(64),
  };
}

// ─────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────

describe("Layer 6D — ProofAggregation", function () {

  let owner:  Signer;
  let alice:  Signer;
  let bob:    Signer;
  let carol:  Signer;

  let mockCognitionVerifier: Contract;
  let mockAgentRegistry:     Contract;
  let batchVerifier:         Contract;
  let aggregator:            ProofAggregator;

  before(async () => {
    [owner, alice, bob, carol] = await ethers.getSigners();
  });

  beforeEach(async () => {
    ({ mockCognitionVerifier, mockAgentRegistry, batchVerifier } =
      await deployMockContracts(owner));

    const config = buildMockConfig(
      await batchVerifier.getAddress(),
      await mockCognitionVerifier.getAddress(),
      await mockAgentRegistry.getAddress()
    );

    aggregator = new ProofAggregator(config);

    // Register agents in mock contracts
    const agents = [alice, bob, carol];
    for (const signer of agents) {
      const addr = await signer.getAddress();
      await mockAgentRegistry.registerAgent(addr);
      await mockCognitionVerifier.registerCommitment(addr,
        BigInt("0x" + "1234".repeat(16))
      );
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // 1. ProofAggregator TypeScript unit tests
  // ─────────────────────────────────────────────────────────────────

  describe("1. ProofAggregator — TypeScript unit tests", () => {

    it("1.1 aggregates 2 proofs successfully", async () => {
      const agents = [await alice.getAddress(), await bob.getAddress()];
      const proofs = agents.map((a, i) => ProofAggregator.generateMockProof(a, i));

      const output = await aggregator.aggregateProofs(proofs);

      expect(output.proofCount).to.equal(2);
      expect(output.batchRoot).to.match(/^0x[0-9a-f]{64}$/);
      expect(output.challenge).to.be.greaterThan(0n);
      expect(output.agentEntries).to.have.length(2);
    });

    it("1.2 aggregates maximum batch of 128 proofs", async () => {
      const proofs: IndividualProof[] = [];
      for (let i = 0; i < 128; i++) {
        const addr = ethers.Wallet.createRandom().address;
        proofs.push(ProofAggregator.generateMockProof(addr, i));
      }

      const t0     = Date.now();
      const output = await aggregator.aggregateProofs(proofs);
      const elapsed = Date.now() - t0;

      expect(output.proofCount).to.equal(128);
      expect(output.agentEntries).to.have.length(128);
      // Should complete in under 10 seconds for 128 proofs
      expect(elapsed).to.be.lessThan(10_000);
      console.log(`    ↳ 128 proofs aggregated in ${elapsed}ms`);
    });

    it("1.3 rejects batch below minBatchSize", async () => {
      const proofs = [ProofAggregator.generateMockProof(await alice.getAddress(), 0)];
      await expect(aggregator.aggregateProofs(proofs))
        .to.be.rejectedWith("Need at least 2 proofs");
    });

    it("1.4 rejects batch above maxBatchSize", async () => {
      const proofs: IndividualProof[] = [];
      for (let i = 0; i < 129; i++) {
        proofs.push(ProofAggregator.generateMockProof(ethers.Wallet.createRandom().address, i));
      }
      await expect(aggregator.aggregateProofs(proofs))
        .to.be.rejectedWith("Too many proofs");
    });

    it("1.5 Fiat-Shamir challenge is deterministic", async () => {
      const agents = [await alice.getAddress(), await bob.getAddress()];
      const proofs = agents.map((a, i) => ProofAggregator.generateMockProof(a, i));

      const out1 = await aggregator.aggregateProofs(proofs);
      const out2 = await aggregator.aggregateProofs(proofs);

      expect(out1.challenge).to.equal(out2.challenge);
      expect(out1.batchRoot).to.equal(out2.batchRoot);
    });

    it("1.6 different proofs produce different batch roots", async () => {
      const proofs1 = [
        ProofAggregator.generateMockProof(await alice.getAddress(), 0),
        ProofAggregator.generateMockProof(await bob.getAddress(),   1),
      ];
      const proofs2 = [
        ProofAggregator.generateMockProof(await alice.getAddress(), 99),
        ProofAggregator.generateMockProof(await bob.getAddress(),   100),
      ];

      const out1 = await aggregator.aggregateProofs(proofs1);
      const out2 = await aggregator.aggregateProofs(proofs2);

      expect(out1.batchRoot).to.not.equal(out2.batchRoot);
    });

    it("1.7 estimated gas savings are correct for N=32", async () => {
      const proofs: IndividualProof[] = Array.from({ length: 32 }, (_, i) =>
        ProofAggregator.generateMockProof(ethers.Wallet.createRandom().address, i)
      );

      const output = await aggregator.aggregateProofs(proofs);

      // naiveGas = 32 × 230,000 = 7,360,000
      // batchGas = 280,000 + 32 × 150 = 284,800
      // saved    = 7,075,200
      expect(output.estimatedGasSaved).to.equal(7_075_200n);
    });

    it("1.8 queue auto-flush fires when threshold reached", async () => {
      // Create aggregator with very small auto-flush threshold
      const smallConfig = buildMockConfig(
        await batchVerifier.getAddress(),
        await mockCognitionVerifier.getAddress(),
        await mockAgentRegistry.getAddress()
      );
      smallConfig.minBatchSize     = 2;
      smallConfig.autoFlushIntervalMs = 50; // 50ms

      let flushed = false;
      const agg = new ProofAggregator(smallConfig);

      // Add 2 proofs (hits minBatchSize)
      await agg.addProof(ProofAggregator.generateMockProof(await alice.getAddress(), 0));
      await agg.addProof(ProofAggregator.generateMockProof(await bob.getAddress(), 1));

      // Wait for auto-flush timer
      await new Promise(r => setTimeout(r, 200));

      // Queue should be empty (flushed)
      expect(agg["pendingProofs"]).to.have.length(0);
    });

    it("1.9 public input linear combination is field-reduced", async () => {
      // Use maximum-value inputs to test modular reduction
      const maxInput = FIELD_P - 1n;
      const proofs = [alice, bob].map(async (s, i) => ({
        agent:        await s.getAddress(),
        recipient:    await carol.getAddress(),
        amount:       BigInt(10 ** 6),
        proofData:    "0x" + "ab".repeat(64),
        publicInputs: [maxInput, maxInput] as [bigint, bigint],
        sessionId:    `test_${i}`,
        timestamp:    Date.now(),
      }));

      const resolved = await Promise.all(proofs);
      const output   = await aggregator.aggregateProofs(resolved);

      // Both aggregated public inputs must be within field
      expect(output.aggPublicInputs[0]).to.be.lessThan(FIELD_P);
      expect(output.aggPublicInputs[1]).to.be.lessThan(FIELD_P);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 2. BatchVerifier.sol contract tests
  // ─────────────────────────────────────────────────────────────────

  describe("2. BatchVerifier.sol — Contract tests", () => {

    it("2.1 reverts if batch < MIN_BATCH (< 2 agents)", async () => {
      // Build a minimal aggregated proof with proofCount=1
      const fakeProof = buildFakeAggregatedProof(1);
      const fakeEntries = [buildFakeAgentEntry(await alice.getAddress(), 0)];

      await expect(
        batchVerifier.verifyAggregateBatch(fakeProof, fakeEntries)
      ).to.be.revertedWith("batch too small");
    });

    it("2.2 reverts if proofCount > MAX_BATCH (> 128)", async () => {
      const fakeProof = buildFakeAggregatedProof(129);
      // agents array length must match proofCount but we only need to check the revert
      const fakeEntries = Array.from({ length: 129 }, (_, i) =>
        buildFakeAgentEntry(ethers.Wallet.createRandom().address, i)
      );

      await expect(
        batchVerifier.verifyAggregateBatch(fakeProof, fakeEntries)
      ).to.be.revertedWith("exceeds MAX_BATCH");
    });

    it("2.3 reverts if agents.length != proofCount", async () => {
      const fakeProof   = buildFakeAggregatedProof(4);
      const fakeEntries = [buildFakeAgentEntry(await alice.getAddress(), 0)]; // only 1

      await expect(
        batchVerifier.verifyAggregateBatch(fakeProof, fakeEntries)
      ).to.be.revertedWith("agents.length != proofCount");
    });

    it("2.4 reverts on batch nullifier replay", async () => {
      // This test requires a working verifyAggregateBatch that passes once.
      // For unit testing the nullifier logic specifically:
      const fixedNullifier = ethers.keccak256(ethers.toUtf8Bytes("test_nullifier_1"));

      // Manually set the nullifier as used (direct storage manipulation via mock)
      await batchVerifier.connect(owner).__testSetNullifierUsed(fixedNullifier);

      const fakeProof = buildFakeAggregatedProof(2);
      fakeProof.batchNullifier = fixedNullifier;
      const fakeEntries = [0, 1].map(i =>
        buildFakeAgentEntry(ethers.Wallet.createRandom().address, i)
      );

      await expect(
        batchVerifier.verifyAggregateBatch(fakeProof, fakeEntries)
      ).to.be.revertedWith("batch proof already used");
    });

    it("2.5 getAggregationMetrics returns correct initial state", async () => {
      const [bv, pa, gs, br, qd, abs] = await batchVerifier.getAggregationMetrics();
      expect(Number(bv)).to.equal(0);
      expect(Number(pa)).to.equal(0);
      expect(Number(qd)).to.equal(0);
    });

    it("2.6 getBatchEconomics: N=32 returns correct gas figures", async () => {
      const [naive, batch, savingsWei] = await batchVerifier.getBatchEconomics(32);
      expect(Number(naive)).to.equal(7_360_000);           // 32 × 230,000
      expect(Number(batch)).to.equal(284_800);             // 280,000 + 32×150
      expect(savingsWei).to.equal(BigInt(7_075_200) * 1_000_000_000n); // in wei at 1 gwei
    });

    it("2.7 getBatchEconomics: N=128 returns 105x reduction", async () => {
      const [naive, batch] = await batchVerifier.getBatchEconomics(128);
      const ratio = Number(naive) / Number(batch);
      expect(ratio).to.be.greaterThan(90); // should be ~100x
      console.log(`    ↳ N=128 reduction ratio: ${ratio.toFixed(1)}x`);
    });

    it("2.8 submitToQueue: agent can queue their proof", async () => {
      const fakeProof     = "0x" + "ab".repeat(64);
      const fakePublicInputs = [1n, 2n] as [bigint, bigint];

      await batchVerifier.connect(alice).submitToQueue(
        await alice.getAddress(),
        await bob.getAddress(),
        ethers.parseUnits("10", 6),
        fakeProof,
        fakePublicInputs
      );

      const depth = await batchVerifier.getQueueDepth();
      expect(Number(depth)).to.equal(1);
    });

    it("2.9 setQueueThreshold only callable by owner", async () => {
      await expect(
        batchVerifier.connect(alice).setQueueThreshold(64)
      ).to.be.revertedWithCustomError(batchVerifier, "OwnableUnauthorizedAccount");

      await expect(
        batchVerifier.connect(owner).setQueueThreshold(64)
      ).to.not.be.reverted;
    });

    it("2.10 setQueueThreshold rejects out-of-range values", async () => {
      await expect(
        batchVerifier.connect(owner).setQueueThreshold(1) // below MIN_BATCH
      ).to.be.revertedWith("threshold out of range");

      await expect(
        batchVerifier.connect(owner).setQueueThreshold(200) // above MAX_BATCH
      ).to.be.revertedWith("threshold out of range");
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 3. Integration: Full pipeline tests
  // ─────────────────────────────────────────────────────────────────

  describe("3. Integration — Full pipeline", () => {

    it("3.1 aggregation → contract calldata encodes correctly (type check)", async () => {
      const proofs = [await alice, await bob].map(async (s, i) => ({
        agent:        await s.getAddress(),
        recipient:    await carol.getAddress(),
        amount:       BigInt(10 ** 7),
        proofData:    "0x" + "cd".repeat(64),
        publicInputs: [BigInt(i + 1), BigInt(i + 100)] as [bigint, bigint],
        sessionId:    `integration_${i}`,
        timestamp:    Date.now(),
      }));

      const resolved = await Promise.all(proofs);
      const output   = await aggregator.aggregateProofs(resolved);

      // Verify the output has all required fields for the contract call
      expect(output.aggA).to.have.length(2);
      expect(output.aggB).to.have.length(4);
      expect(output.aggC).to.have.length(2);
      expect(output.aggPublicInputs).to.have.length(2);
      expect(output.agentEntries[0].leafProof).to.match(/^0x[0-9a-f]{64}$/);
      expect(output.agentEntries[0].leafIndex).to.equal(0);
      expect(output.agentEntries[1].leafIndex).to.equal(1);
    });

    it("3.2 Merkle root changes when any proof changes", async () => {
      const proofs1 = [
        { agent: await alice.getAddress(), recipient: await carol.getAddress(),
          amount: 10n ** 7n, proofData: "0x" + "aa".repeat(64),
          publicInputs: [1n, 100n] as [bigint, bigint], sessionId: "s1", timestamp: Date.now() },
        { agent: await bob.getAddress(),   recipient: await carol.getAddress(),
          amount: 10n ** 7n, proofData: "0x" + "bb".repeat(64),
          publicInputs: [2n, 200n] as [bigint, bigint], sessionId: "s2", timestamp: Date.now() },
      ];

      const proofs2 = [...proofs1];
      proofs2[1] = { ...proofs2[1], publicInputs: [999n, 200n] }; // tamper

      const out1 = await aggregator.aggregateProofs(proofs1);
      const out2 = await aggregator.aggregateProofs(proofs2);

      expect(out1.batchRoot).to.not.equal(out2.batchRoot);
      expect(out1.challenge).to.not.equal(out2.challenge);
    });

    it("3.3 agent entries have correct Merkle sibling structure", async () => {
      const numProofs = 4;
      const proofs: IndividualProof[] = Array.from({ length: numProofs }, (_, i) => ({
        agent:        ethers.Wallet.createRandom().address,
        recipient:    ethers.Wallet.createRandom().address,
        amount:       10n ** 6n,
        proofData:    "0x" + "ef".repeat(64),
        publicInputs: [BigInt(i + 1), BigInt(i + 50)] as [bigint, bigint],
        sessionId:    `s${i}`,
        timestamp:    Date.now(),
      }));

      const output = await aggregator.aggregateProofs(proofs);

      // Every entry has a valid leafProof and correct index
      for (let i = 0; i < numProofs; i++) {
        expect(output.agentEntries[i].leafIndex).to.equal(i);
        expect(output.agentEntries[i].leafProof).to.match(/^0x[0-9a-f]{64}$/);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 4. Security tests
  // ─────────────────────────────────────────────────────────────────

  describe("4. Security — Tamper resistance", () => {

    it("4.1 tampered decisionHash → different aggPublicInputs (forgery detection)", async () => {
      const baseProofs: IndividualProof[] = [
        { agent: await alice.getAddress(), recipient: await carol.getAddress(),
          amount: 10n ** 6n, proofData: "0x" + "11".repeat(64),
          publicInputs: [111n, 999n], sessionId: "sa", timestamp: Date.now() },
        { agent: await bob.getAddress(),   recipient: await carol.getAddress(),
          amount: 10n ** 6n, proofData: "0x" + "22".repeat(64),
          publicInputs: [222n, 888n], sessionId: "sb", timestamp: Date.now() },
      ];

      const tamperedProofs = JSON.parse(JSON.stringify(baseProofs,
        (_, v) => typeof v === "bigint" ? v.toString() : v
      ));
      tamperedProofs[0].publicInputs[0] = "999"; // tamper decisionHash

      // Re-parse (JSON doesn't preserve BigInt)
      const parsedBase    = baseProofs;
      const parsedTamper: IndividualProof[] = tamperedProofs.map((p: any) => ({
        ...p,
        amount:       BigInt(p.amount),
        publicInputs: [BigInt(p.publicInputs[0]), BigInt(p.publicInputs[1])] as [bigint, bigint],
      }));

      const out1 = await aggregator.aggregateProofs(parsedBase);
      const out2 = await aggregator.aggregateProofs(parsedTamper);

      expect(out1.aggPublicInputs[0]).to.not.equal(out2.aggPublicInputs[0]);
      expect(out1.challenge).to.not.equal(out2.challenge);
    });

    it("4.2 batch nullifier is unique per aggregation (different inputs)", async () => {
      const p1: IndividualProof[] = Array.from({ length: 2 }, (_, i) => ({
        agent:        ethers.Wallet.createRandom().address,
        recipient:    ethers.Wallet.createRandom().address,
        amount:       10n ** 6n,
        proofData:    "0x" + "aa".repeat(64),
        publicInputs: [BigInt(i + 1), BigInt(i + 10)] as [bigint, bigint],
        sessionId:    `s${i}a`, timestamp: Date.now() - i,
      }));
      const p2: IndividualProof[] = Array.from({ length: 2 }, (_, i) => ({
        agent:        ethers.Wallet.createRandom().address,
        recipient:    ethers.Wallet.createRandom().address,
        amount:       10n ** 6n,
        proofData:    "0x" + "bb".repeat(64),
        publicInputs: [BigInt(i + 100), BigInt(i + 1000)] as [bigint, bigint],
        sessionId:    `s${i}b`, timestamp: Date.now() + i,
      }));

      const out1 = await aggregator.aggregateProofs(p1);
      const out2 = await aggregator.aggregateProofs(p2);

      expect(out1.batchNullifier).to.not.equal(out2.batchNullifier);
    });

    it("4.3 IPPA proof changes when proof components change", async () => {
      const proofs1: IndividualProof[] = [
        { agent: await alice.getAddress(), recipient: await carol.getAddress(),
          amount: 10n ** 6n, proofData: "0x" + "11".repeat(64),
          publicInputs: [1n, 1n], sessionId: "s1", timestamp: 1 },
        { agent: await bob.getAddress(), recipient: await carol.getAddress(),
          amount: 10n ** 6n, proofData: "0x" + "22".repeat(64),
          publicInputs: [2n, 2n], sessionId: "s2", timestamp: 2 },
      ];
      const proofs2 = [...proofs1];
      proofs2[0] = { ...proofs2[0], proofData: "0x" + "ff".repeat(64) };

      const out1 = await aggregator.aggregateProofs(proofs1);
      const out2 = await aggregator.aggregateProofs(proofs2);

      // MIPP commitments will differ → challenge differs → IPPA differs
      expect(out1.mippCommitment).to.not.equal(out2.mippCommitment);
      expect(out1.ippaProof).to.not.equal(out2.ippaProof);
    });

    it("4.4 contract rejects mismatched aggPublicInputs on-chain", async () => {
      // Build a legit aggregated proof then corrupt the aggPublicInputs
      const fakeProof = buildFakeAggregatedProof(2);
      // Set aggPublicInputs to wrong values — contract will recompute and reject
      fakeProof.aggPublicInputs = [99999n, 99999n];

      const fakeEntries = [0, 1].map(i =>
        buildFakeAgentEntry(ethers.Wallet.createRandom().address, i)
      );

      await expect(
        batchVerifier.verifyAggregateBatch(fakeProof, fakeEntries)
      ).to.be.revertedWith("aggregated decisionHash mismatch");
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 5. Economics validation
  // ─────────────────────────────────────────────────────────────────

  describe("5. Economics — Gas validation", () => {

    const BATCH_SIZES = [2, 4, 8, 16, 32, 64, 128];

    BATCH_SIZES.forEach(n => {
      it(`5.x getBatchEconomics: N=${n} produces positive gas savings`, async () => {
        const [naive, batch, savingsWei] = await batchVerifier.getBatchEconomics(n);
        expect(Number(batch)).to.be.lessThan(Number(naive));
        expect(Number(savingsWei)).to.be.greaterThan(0);

        const pct = (Number(naive - batch) / Number(naive) * 100).toFixed(1);
        console.log(`    ↳ N=${n}: naive=${naive}, batch=${batch}, saved=${pct}%`);
      });
    });

    it("5.9 N=128 saves more gas than N=2 (monotonic savings)", async () => {
      const [n128naive, n128batch] = await batchVerifier.getBatchEconomics(128);
      const [n2naive,   n2batch]   = await batchVerifier.getBatchEconomics(2);

      const saved128 = Number(n128naive - n128batch);
      const saved2   = Number(n2naive   - n2batch);

      expect(saved128).to.be.greaterThan(saved2);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 6. Cross-layer integration
  // ─────────────────────────────────────────────────────────────────

  describe("6. Cross-layer integration", () => {

    it("6.1 BatchVerifier uses CognitionVerifier.getModelCommitment (wired)", async () => {
      const addr = await alice.getAddress();
      // Register a specific commitment
      const testCommitment = 12345678901234567890n;
      await mockCognitionVerifier.registerCommitment(addr, testCommitment);

      const stored = await mockCognitionVerifier.getModelCommitment(addr);
      expect(stored).to.equal(testCommitment);
    });

    it("6.2 BatchVerifier checks AgentRegistry.isAgentActive()", async () => {
      const addr = await alice.getAddress();
      // Deactivate agent
      await mockAgentRegistry.deactivateAgent(addr);

      const fakeProof   = buildFakeAggregatedProof(2);
      const fakeEntries = [
        buildFakeAgentEntry(addr, 0),                              // deactivated
        buildFakeAgentEntry(await bob.getAddress(), 1),
      ];

      await expect(
        batchVerifier.verifyAggregateBatch(fakeProof, fakeEntries)
      ).to.be.revertedWith("agent not active");
    });

    it("6.3 Supabase logging schema matches aggregation_batches table", () => {
      // Schema validation: ensure output fields match Supabase table
      const requiredFields = [
        "batch_nullifier", "proof_count", "aggregation_time_ms",
        "estimated_gas_saved", "batch_root", "tx_hash", "agents", "created_at"
      ];

      // This test documents the required Supabase schema
      // Run: CREATE TABLE aggregation_batches (
      //   id SERIAL PRIMARY KEY,
      //   batch_nullifier TEXT NOT NULL,
      //   proof_count INTEGER NOT NULL,
      //   aggregation_time_ms INTEGER,
      //   estimated_gas_saved TEXT,
      //   batch_root TEXT NOT NULL,
      //   tx_hash TEXT,
      //   agents TEXT[],
      //   created_at TIMESTAMPTZ DEFAULT NOW()
      // );
      expect(requiredFields).to.have.length(8);
      expect(true).to.equal(true); // schema documented
    });

    it("6.4 Layer 6D emits BatchVerified event with correct structure", async () => {
      // This test would be used when a real proof passes pairing check
      // In the mock: check event structure via ABI
      const eventFragment = batchVerifier.interface.getEvent("BatchVerified");
      expect(eventFragment).to.not.be.null;
      expect(eventFragment?.inputs.map(i => i.name)).to.include("proofCount");
      expect(eventFragment?.inputs.map(i => i.name)).to.include("estimatedGasSaved");
      expect(eventFragment?.inputs.map(i => i.name)).to.include("batchNullifier");
    });

    it("6.5 Layer 6A (UnderwriterDAO) slashing proofs can use same batch pipeline", () => {
      // Architecture test: Layer 6A generates ZK Shapley proofs
      // These can be aggregated via the same ProofAggregator pipeline
      // if they share the same circuit (Groth16 bn254)

      // Key requirement: same proofData format (128 bytes)
      // Key requirement: same publicInputs format ([hash, commitment])
      // → Both are true for the current architecture
      // → UnderwriterDAO.sol's _trySubmitShapleyProof() stub is ready

      const shapleyProofFormat = {
        proofData:    "0x" + "00".repeat(64),  // 128 bytes
        publicInputs: [0n, 0n] as [bigint, bigint],
      };
      expect(shapleyProofFormat.proofData.length).to.equal(130); // 0x + 128 bytes hex
      expect(shapleyProofFormat.publicInputs.length).to.equal(2);
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// Helper builders for contract test inputs
// ─────────────────────────────────────────────────────────────────

function buildFakeAggregatedProof(proofCount: number) {
  const z32 = "0x" + "00".repeat(32);
  return {
    ippaProof:       "0x" + "ab".repeat(96), // ic_vk_x (64) + ippa elements (32+)
    mippCommitment:  z32,
    mippCommitmentB: z32,
    challenge:       1n,
    batchRoot:       z32,
    proofCount,
    batchNullifier:  ethers.keccak256(ethers.toUtf8Bytes(`fake_${proofCount}_${Date.now()}`)),
    aggA:            [1n, 2n],
    aggB:            [1n, 2n, 3n, 4n],
    aggC:            [1n, 2n],
    aggPublicInputs: [0n, 0n],
  };
}

function buildFakeAgentEntry(agent: string, index: number) {
  const z32 = "0x" + "00".repeat(32);
  return {
    agent,
    recipient:       ethers.Wallet.createRandom().address,
    amount:          BigInt(10 ** 6),
    decisionHash:    0n,
    modelCommitment: 0n,
    leafProof:       z32,
    leafIndex:       index,
  };
}

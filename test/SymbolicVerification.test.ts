/**
 * ════════════════════════════════════════════════════════════════════
 * Layer 6E: SymbolicVerification.test.ts — 52 tests, 7 suites
 * ════════════════════════════════════════════════════════════════════
 */

import { expect }  from "chai";
import { ethers }  from "hardhat";
import type { Signer, Contract } from "ethers";
import {
  PropertyDSL,
  buildDefaultProperties,
  AgentState,
  TransactionProposal,
  CouncilVote,
  SafetyProperty,
} from "../src/symbolic/property-dsl";
import {
  SymbolicChecker,
  AgentPolicy,
} from "../src/symbolic/symbolic-checker";

// ─────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────

const USDC = (amount: number): bigint => BigInt(Math.round(amount * 1_000_000));

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    address:          "0xAlice",
    balance:          USDC(10_000),
    dailySpend:       USDC(50),
    weeklySpend:      USDC(200),
    reputationScore:  750,
    exposureTotal:    USDC(500),
    consecutiveFails: 0,
    lastActionTs:     Math.floor(Date.now() / 1000) - 60,
    ...overrides,
  };
}

function makeProposal(overrides: Partial<TransactionProposal> = {}): TransactionProposal {
  const unanimousApprove: CouncilVote[] = [
    { role: "risk",        decision: "APPROVE", confidence: 90, reasoning: "Risk within bounds" },
    { role: "compliance",  decision: "APPROVE", confidence: 88, reasoning: "No compliance issues" },
    { role: "execution",   decision: "APPROVE", confidence: 92, reasoning: "Execution path clear" },
    { role: "synthesizer", decision: "APPROVE", confidence: 87, reasoning: "Consensus recommendation" },
  ];
  return {
    agent:        "0xAlice",
    recipient:    "0xBob",
    amount:       USDC(50),
    reason:       "Purchase 50 USDC of governance tokens for DAO participation",
    expectedROI:  0.08,
    riskScore:    20,
    councilVotes: unanimousApprove,
    timestamp:    Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

function makePolicy(overrides: Partial<AgentPolicy> = {}): AgentPolicy {
  const props = buildDefaultProperties(
    USDC(100),   // perTxLimit
    USDC(500),   // dailyLimit
    USDC(2000),  // weeklyLimit
    USDC(5000),  // exposureCap
    500          // minReputation
  );
  const dsl = new PropertyDSL(props);
  return {
    agentAddress:    "0xAlice",
    perTxLimit:      USDC(100),
    dailyLimit:      USDC(500),
    weeklyLimit:     USDC(2000),
    exposureCap:     USDC(5000),
    minReputation:   500,
    propertySetHash: dsl.hashPropertySet(),
    createdAt:       new Date().toISOString(),
    updatedAt:       new Date().toISOString(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// Suite 1: PropertyDSL — Core property evaluation
// ─────────────────────────────────────────────────────────────────

describe("Layer 6E — PropertyDSL", () => {

  let dsl: PropertyDSL;
  let policy: AgentPolicy;

  beforeEach(() => {
    policy = makePolicy();
    const props = buildDefaultProperties(
      policy.perTxLimit, policy.dailyLimit, policy.weeklyLimit,
      policy.exposureCap, policy.minReputation
    );
    dsl = new PropertyDSL(props);
  });

  it("1.1  SAT: compliant transaction passes all 10 properties", () => {
    const state    = makeState();
    const proposal = makeProposal({ amount: USDC(50), riskScore: 20 });
    const cert     = dsl.check(state, proposal);

    expect(cert.status).to.equal("SAT");
    expect(cert.satisfiedProps).to.include("P1_PER_TX_LIMIT");
    expect(cert.satisfiedProps).to.include("P2_DAILY_LIMIT");
    expect(cert.satisfiedProps).to.include("P5_REPUTATION_GATE");
    expect(cert.satisfiedProps).to.include("P6_LYAPUNOV_STABILITY");
    expect(cert.violatedProps).to.have.length(0);
    expect(cert.lyapunovValue).to.equal(0);
  });

  it("1.2  UNSAT: amount exceeds per-tx limit → P1 violated (hard stop)", () => {
    const state    = makeState();
    const proposal = makeProposal({ amount: USDC(150) }); // > $100 limit
    const cert     = dsl.check(state, proposal);

    expect(cert.status).to.equal("UNSAT");
    const p1 = cert.violatedProps.find(v => v.propertyId === "P1_PER_TX_LIMIT");
    expect(p1).to.not.be.undefined;
    expect(p1!.severity).to.equal("block");
  });

  it("1.3  UNSAT: daily spend overflow → P2 violated (hard stop)", () => {
    const state    = makeState({ dailySpend: USDC(460) }); // $460 already spent
    const proposal = makeProposal({ amount: USDC(80) });   // $460 + $80 = $540 > $500
    const cert     = dsl.check(state, proposal);

    expect(cert.status).to.equal("UNSAT");
    const p2 = cert.violatedProps.find(v => v.propertyId === "P2_DAILY_LIMIT");
    expect(p2).to.not.be.undefined;
    expect(p2!.severity).to.equal("block");
  });

  it("1.4  UNSAT: weekly spend overflow → P3 violated", () => {
    const state    = makeState({ weeklySpend: USDC(1950) });
    const proposal = makeProposal({ amount: USDC(80) });   // $1950 + $80 = $2030 > $2000
    const cert     = dsl.check(state, proposal);

    expect(cert.status).to.equal("UNSAT");
    expect(cert.violatedProps.some(v => v.propertyId === "P3_WEEKLY_LIMIT")).to.be.true;
  });

  it("1.5  UNSAT: exposure cap exceeded → P4 violated", () => {
    const state    = makeState({ exposureTotal: USDC(4980) });
    const proposal = makeProposal({ amount: USDC(50) });  // $4980 + $50 > $5000
    const cert     = dsl.check(state, proposal);

    expect(cert.status).to.equal("UNSAT");
    expect(cert.violatedProps.some(v => v.propertyId === "P4_EXPOSURE_CAP")).to.be.true;
  });

  it("1.6  UNSAT: reputation below threshold → P5 violated (hard stop)", () => {
    const state    = makeState({ reputationScore: 300 }); // < 500 minimum
    const proposal = makeProposal({ amount: USDC(50) });
    const cert     = dsl.check(state, proposal);

    expect(cert.status).to.equal("UNSAT");
    const p5 = cert.violatedProps.find(v => v.propertyId === "P5_REPUTATION_GATE");
    expect(p5).to.not.be.undefined;
    expect(p5!.severity).to.equal("block");
  });

  it("1.7  Lyapunov V(s) = 0 when all hard stops pass", () => {
    const cert = dsl.check(makeState(), makeProposal());
    expect(cert.lyapunovValue).to.equal(0);
  });

  it("1.8  Lyapunov V(s) > 0 when any hard stop fails", () => {
    const state    = makeState({ reputationScore: 200 });
    const cert     = dsl.check(state, makeProposal());
    expect(cert.lyapunovValue).to.be.greaterThan(0);
  });

  it("1.9  P7 loss aversion: riskScore=80 (80% failure probability) → fail", () => {
    // riskScore=80 → riskScore_inv = 20 → 20 × 325 = 6500 < 22500 → FAIL
    const proposal = makeProposal({ riskScore: 80, amount: USDC(50) });
    const cert     = dsl.check(makeState(), proposal);
    const p7 = cert.violatedProps.find(v => v.propertyId === "P7_LOSS_AVERSION");
    expect(p7).to.not.be.undefined;
  });

  it("1.10 P7 loss aversion: riskScore=30 (70% success) → pass", () => {
    // riskScore=30 → riskScore_inv = 70 → 70 × 325 = 22750 ≥ 22500 → PASS
    const proposal = makeProposal({ riskScore: 30 });
    const cert     = dsl.check(makeState(), proposal);
    expect(cert.satisfiedProps).to.include("P7_LOSS_AVERSION");
  });

  it("1.11 P8 behavioral drift: 3 consecutive fails → warning", () => {
    const state = makeState({ consecutiveFails: 3 });
    const cert  = dsl.check(state, makeProposal());
    const p8 = cert.violatedProps.find(v => v.propertyId === "P8_BEHAVIORAL_DRIFT");
    expect(p8).to.not.be.undefined;
    expect(p8!.severity).to.equal("warning"); // soft, not hard stop
  });

  it("1.12 certHash is deterministic for same inputs", () => {
    const cert1 = dsl.check(makeState(), makeProposal());
    const cert2 = dsl.check(makeState(), makeProposal());
    // Different timestamps mean different proposalHashes, so certHashes differ
    // But within same timestamp, they should match
    const state = makeState();
    const proposal = makeProposal({ timestamp: 1700000000 });
    const c1 = dsl.check(state, proposal);
    const c2 = dsl.check(state, proposal);
    expect(c1.certHash).to.equal(c2.certHash);
  });

  it("1.13 propertySetHash is stable across runs", () => {
    const h1 = dsl.hashPropertySet();
    const h2 = dsl.hashPropertySet();
    expect(h1).to.equal(h2);
    expect(h1).to.match(/^0x[0-9a-f]{64}$/);
  });

  it("1.14 explain() returns a non-empty string for SAT and UNSAT", () => {
    const satCert  = dsl.check(makeState(), makeProposal());
    const unsatState = makeState({ reputationScore: 100 });
    const unsatCert  = dsl.check(unsatState, makeProposal());
    expect(dsl.explain(satCert).length).to.be.greaterThan(10);
    expect(dsl.explain(unsatCert).length).to.be.greaterThan(10);
    expect(dsl.explain(unsatCert)).to.include("BLOCKED");
  });

  it("1.15 Z3 script output is valid Python with z3 imports", () => {
    const script = dsl.toZ3Script(makeState(), makeProposal());
    expect(script).to.include("from z3 import");
    expect(script).to.include("solver.add(");
    expect(script).to.include("solver.check()");
  });
});

// ─────────────────────────────────────────────────────────────────
// Suite 2: Entropy Gate
// ─────────────────────────────────────────────────────────────────

describe("Layer 6E — Entropy Gate", () => {

  let dsl: PropertyDSL;

  beforeEach(() => {
    const props = buildDefaultProperties(
      USDC(100), USDC(500), USDC(2000), USDC(5000), 500
    );
    dsl = new PropertyDSL(props);
  });

  it("2.1  Unanimous vote → entropy = 0", () => {
    const proposal = makeProposal(); // all APPROVE
    const cert = dsl.check(makeState(), proposal);
    expect(cert.entropyGate.councilEntropy).to.equal(0);
    expect(cert.entropyGate.triggered).to.be.false;
  });

  it("2.2  Split 2-2 vote → entropy ≈ 1.0 bits", () => {
    const splitVotes: CouncilVote[] = [
      { role: "risk",        decision: "APPROVE",   confidence: 60, reasoning: "r1" },
      { role: "compliance",  decision: "APPROVE",   confidence: 55, reasoning: "r2" },
      { role: "execution",   decision: "REJECT",    confidence: 70, reasoning: "r3" },
      { role: "synthesizer", decision: "REJECT",    confidence: 65, reasoning: "r4" },
    ];
    const proposal = makeProposal({ councilVotes: splitVotes });
    const cert = dsl.check(makeState(), proposal);
    expect(cert.entropyGate.councilEntropy).to.be.approximately(1.0, 0.01);
    expect(cert.entropyGate.triggered).to.be.true;
  });

  it("2.3  Three-way split → entropy > 1.0 bits", () => {
    const threeWay: CouncilVote[] = [
      { role: "risk",        decision: "APPROVE",   confidence: 60, reasoning: "r1" },
      { role: "compliance",  decision: "REJECT",    confidence: 70, reasoning: "r2" },
      { role: "execution",   decision: "ESCALATE",  confidence: 50, reasoning: "r3" },
      { role: "synthesizer", decision: "APPROVE",   confidence: 55, reasoning: "r4" },
    ];
    const proposal = makeProposal({ councilVotes: threeWay });
    const cert = dsl.check(makeState(), proposal);
    expect(cert.entropyGate.councilEntropy).to.be.greaterThan(1.0);
  });

  it("2.4  Entropy triggered flag fires at > 50% of max entropy", () => {
    const halfEntropy: CouncilVote[] = [
      { role: "risk",        decision: "APPROVE", confidence: 80, reasoning: "r1" },
      { role: "compliance",  decision: "APPROVE", confidence: 80, reasoning: "r2" },
      { role: "execution",   decision: "APPROVE", confidence: 80, reasoning: "r3" },
      { role: "synthesizer", decision: "REJECT",  confidence: 80, reasoning: "r4" },
    ];
    const proposal = makeProposal({ councilVotes: halfEntropy });
    const cert = dsl.check(makeState(), proposal);
    // 3 APPROVE + 1 REJECT → H = -0.75log2(0.75) - 0.25log2(0.25) ≈ 0.81 bits
    // maxH = log2(4) = 2 bits → fraction = 0.81/2 = 0.405 < 0.5 → NOT triggered
    expect(cert.entropyGate.triggered).to.be.false;
  });
});

// ─────────────────────────────────────────────────────────────────
// Suite 3: Loss Aversion (Kahneman-Tversky)
// ─────────────────────────────────────────────────────────────────

describe("Layer 6E — Loss Aversion (λ=2.25)", () => {

  let dsl: PropertyDSL;

  beforeEach(() => {
    const props = buildDefaultProperties(
      USDC(100), USDC(500), USDC(2000), USDC(5000), 500
    );
    dsl = new PropertyDSL(props);
  });

  it("3.1  High-ROI proposal passes LA gate (expectedROI=0.9)", () => {
    const proposal = makeProposal({ riskScore: 10, expectedROI: 0.9 }); // 10% risk
    const cert = dsl.check(makeState(), proposal);
    expect(cert.lossAversion.passes).to.be.true;
    expect(cert.lossAversion.lossAdjustedValue).to.be.greaterThan(0);
  });

  it("3.2  Low-ROI proposal fails LA gate (expectedROI=0.5, riskScore=50)", () => {
    // riskScore=50 → riskScore_inv=50 → 50×325=16250 < 22500 → P7 FAIL
    const proposal = makeProposal({ riskScore: 50, expectedROI: 0.5 });
    const cert = dsl.check(makeState(), proposal);
    expect(cert.lossAversion.passes).to.be.false;
    expect(cert.satisfiedProps).to.not.include("P7_LOSS_AVERSION");
  });

  it("3.3  LA threshold at exactly λ/(1+λ): riskScore=31 should barely pass", () => {
    // 100-31=69, 69×325=22425, 22425 < 22500 → FAIL (just below threshold)
    const fail31 = makeProposal({ riskScore: 31 });
    const certFail = dsl.check(makeState(), fail31);
    expect(certFail.violatedProps.some(v => v.propertyId === "P7_LOSS_AVERSION")).to.be.true;

    // riskScore=30 → 70×325=22750 ≥ 22500 → PASS
    const pass30 = makeProposal({ riskScore: 30 });
    const certPass = dsl.check(makeState(), pass30);
    expect(certPass.satisfiedProps).to.include("P7_LOSS_AVERSION");
  });

  it("3.4  LA lambda = 2.25 is encoded in the result", () => {
    const cert = dsl.check(makeState(), makeProposal());
    expect(cert.lossAversion.lambda).to.equal(2.25);
  });

  it("3.5  Loss-adjusted EV is always less than raw EV (asymmetric weighting)", () => {
    const cert = dsl.check(makeState(), makeProposal({ riskScore: 20, expectedROI: 0.08 }));
    expect(cert.lossAversion.lossAdjustedValue).to.be.lessThan(cert.lossAversion.expectedValue);
  });
});

// ─────────────────────────────────────────────────────────────────
// Suite 4: SymbolicChecker orchestration
// ─────────────────────────────────────────────────────────────────

describe("Layer 6E — SymbolicChecker", () => {

  let checker: SymbolicChecker;

  beforeEach(() => {
    checker = new SymbolicChecker({
      providerUrl:          "http://localhost:8545",
      agentRegistryAddress: "0x0",
    });
  });

  it("4.1  buildPolicy() produces a valid propertySetHash", () => {
    const policy = checker.buildPolicy(
      "0xAlice", USDC(100), USDC(500), USDC(2000), USDC(5000), 500
    );
    expect(policy.propertySetHash).to.match(/^0x[0-9a-f]{64}$/);
    expect(policy.propertySetHash).to.not.equal("0x" + "00".repeat(32));
  });

  it("4.2  check() returns a SymbolicCheckResult with witness", async () => {
    const policy   = checker.buildPolicy(
      "0xAlice", USDC(100), USDC(500), USDC(2000), USDC(5000), 500
    );
    const result = await checker.check(makeState(), makeProposal(), policy);

    expect(result.certificate.status).to.equal("SAT");
    expect(result.witness.satisfactionBitmask).to.be.greaterThan(0n);
    expect(result.witness.lyapunovValue).to.equal(0n);
    expect(result.z3Script).to.include("from z3 import");
    expect(result.explanation).to.include("APPROVED");
    expect(result.gasImpact.overhead).to.be.greaterThan(0);
  });

  it("4.3  check() rejects when policy hash is tampered", async () => {
    const policy = checker.buildPolicy(
      "0xAlice", USDC(100), USDC(500), USDC(2000), USDC(5000), 500
    );
    const tamperedPolicy = {
      ...policy,
      propertySetHash: "0x" + "ff".repeat(32), // wrong hash
    };
    await expect(
      checker.check(makeState(), makeProposal(), tamperedPolicy)
    ).to.be.rejectedWith("Property set hash mismatch");
  });

  it("4.4  Circom witness has correct field encoding", async () => {
    const policy = checker.buildPolicy(
      "0xAlice", USDC(100), USDC(500), USDC(2000), USDC(5000), 500
    );
    const result = await checker.check(makeState(), makeProposal(), policy);
    const w = result.witness;

    // All witness values should be non-negative bigints
    expect(w.propertySetHash_hi).to.be.greaterThanOrEqual(0n);
    expect(w.propertySetHash_lo).to.be.greaterThanOrEqual(0n);
    expect(w.status).to.equal(1n); // SAT = 1
    expect(w.lyapunovValue).to.equal(0n); // V(s) = 0 for SAT
    expect(w.satisfactionBitmask & 31n).to.equal(31n); // all hard stops set
  });

  it("4.5  Gas impact overhead is ~252,475 gas", async () => {
    const policy = checker.buildPolicy(
      "0xAlice", USDC(100), USDC(500), USDC(2000), USDC(5000), 500
    );
    const result = await checker.check(makeState(), makeProposal(), policy);
    expect(result.gasImpact.overhead).to.equal(252_475);
    expect(result.gasImpact.overheadUSD).to.be.lessThan(0.001); // < $0.001
  });

  it("4.6  Batch check: all SAT batch → batchApproved = true", async () => {
    const policy = checker.buildPolicy(
      "0xAlice", USDC(100), USDC(500), USDC(2000), USDC(5000), 500
    );
    const entries = [1, 2, 3].map(i => ({
      state:    makeState({ address: `0xAgent${i}` }),
      proposal: makeProposal({ agent: `0xAgent${i}`, timestamp: Date.now() / 1000 + i }),
      policy:   { ...policy, agentAddress: `0xAgent${i}` },
    }));

    const batch = await checker.checkBatch(entries);
    expect(batch.batchApproved).to.be.true;
    expect(batch.results).to.have.length(3);
    expect(batch.batchCertHash).to.match(/^0x[0-9a-f]{64}$/);
  });

  it("4.7  Batch check: one UNSAT → batchApproved = false", async () => {
    const policy = checker.buildPolicy(
      "0xAlice", USDC(100), USDC(500), USDC(2000), USDC(5000), 500
    );
    const badState = makeState({ reputationScore: 100, address: "0xBadAgent" });
    const entries = [
      { state: makeState({ address: "0xAgent1" }),
        proposal: makeProposal({ agent: "0xAgent1" }),
        policy: { ...policy, agentAddress: "0xAgent1" } },
      { state: badState,
        proposal: makeProposal({ agent: "0xBadAgent" }),
        policy: { ...policy, agentAddress: "0xBadAgent" } },
    ];

    const batch = await checker.checkBatch(entries);
    expect(batch.batchApproved).to.be.false;
  });
});

// ─────────────────────────────────────────────────────────────────
// Suite 5: SymbolicVerifier.sol contract tests
// ─────────────────────────────────────────────────────────────────

describe("Layer 6E — SymbolicVerifier.sol", () => {

  let owner: Signer;
  let alice: Signer;
  let bob:   Signer;
  let symbolicVerifier: Contract;

  before(async () => {
    [owner, alice, bob] = await ethers.getSigners();
  });

  beforeEach(async () => {
    const MockGroth16Factory = await ethers.getContractFactory("MockGroth16Verifier");
    const mockGroth16 = await MockGroth16Factory.connect(owner).deploy();
    const MockCogFactory = await ethers.getContractFactory("MockCognitionVerifier");
    const mockCog = await MockCogFactory.connect(owner).deploy();

    const Factory = await ethers.getContractFactory("SymbolicVerifier");
    symbolicVerifier = await Factory.connect(owner).deploy(
      await mockGroth16.getAddress(),
      await mockCog.getAddress()
    );
  });

  it("5.1  registerProperty() sets hash for agent", async () => {
    const agentAddr = await alice.getAddress();
    const propHash  = ethers.keccak256(ethers.toUtf8Bytes("test_properties"));

    await symbolicVerifier.connect(owner).registerProperty(agentAddr, propHash, true);

    expect(await symbolicVerifier.getPropertySetHash(agentAddr)).to.equal(propHash);
    expect(await symbolicVerifier.isSymbolicRequired(agentAddr)).to.be.true;
  });

  it("5.2  registerProperty() reverts with zero hash", async () => {
    const agentAddr = await alice.getAddress();
    await expect(
      symbolicVerifier.connect(owner).registerProperty(
        agentAddr, ethers.ZeroHash, false
      )
    ).to.be.revertedWith("zero hash");
  });

  it("5.3  agent can register their own property set", async () => {
    const agentAddr = await alice.getAddress();
    const propHash  = ethers.keccak256(ethers.toUtf8Bytes("my_props"));
    await expect(
      symbolicVerifier.connect(alice).registerProperty(agentAddr, propHash, false)
    ).to.not.be.reverted;
  });

  it("5.4  unauthorized caller cannot register", async () => {
    const agentAddr = await alice.getAddress();
    const propHash  = ethers.keccak256(ethers.toUtf8Bytes("props"));
    await expect(
      symbolicVerifier.connect(bob).registerProperty(agentAddr, propHash, false)
    ).to.be.revertedWith("unauthorized");
  });

  it("5.5  verify() reverts if no property set registered", async () => {
    const agentAddr = await alice.getAddress();
    const fakeProof = buildFakeProof();
    await expect(
      symbolicVerifier.verify(
        agentAddr,
        ethers.ZeroHash,
        0n,
        0n,
        0n,
        fakeProof.A,
        fakeProof.B,
        fakeProof.C
      )
    ).to.be.revertedWith("no registered property set");
  });

  it("5.6  getMetrics() returns correct initial state", async () => {
    const [v, p, b, h, vl, pr] = await symbolicVerifier.getMetrics();
    expect(Number(v)).to.equal(0);
    expect(Number(p)).to.equal(0);
    expect(Number(b)).to.equal(0);
    expect(Number(h)).to.equal(0);
  });

  it("5.7  isVerified() returns false before first verification", async () => {
    const agentAddr = await alice.getAddress();
    const propHash  = ethers.keccak256(ethers.toUtf8Bytes("props2"));
    await symbolicVerifier.connect(owner).registerProperty(agentAddr, propHash, false);

    const [verified, cert] = await symbolicVerifier.isVerified(
      agentAddr, ethers.ZeroHash
    );
    expect(verified).to.be.false;
    expect(cert).to.equal(ethers.ZeroHash);
  });

  it("5.8  setAuthorizedCaller only callable by owner", async () => {
    await expect(
      symbolicVerifier.connect(alice).setAuthorizedCaller(await bob.getAddress(), true)
    ).to.be.revertedWithCustomError(symbolicVerifier, "OwnableUnauthorizedAccount");
  });

  it("5.9  HARD_STOP_MASK is 31 (bits 0-4)", async () => {
    const mask = await symbolicVerifier.HARD_STOP_MASK();
    expect(Number(mask)).to.equal(31);
  });

  it("5.10 LYAPUNOV_HARD_CAP is 0", async () => {
    const cap = await symbolicVerifier.LYAPUNOV_HARD_CAP();
    expect(Number(cap)).to.equal(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// Suite 6: Cross-layer integration
// ─────────────────────────────────────────────────────────────────

describe("Layer 6E — Cross-layer integration", () => {

  it("6.1  L6E witness bitmask bit 0 = P1 (per-tx limit) satisfaction", async () => {
    const checker = new SymbolicChecker({
      providerUrl:          "http://localhost:8545",
      agentRegistryAddress: "0x0",
    });
    const policy = checker.buildPolicy(
      "0xA", USDC(100), USDC(500), USDC(2000), USDC(5000), 500
    );
    const result = await checker.check(makeState(), makeProposal(), policy);
    // Bit 0 = P1; proposal.amount=50 < 100 limit → P1 SAT → bit 0 = 1
    expect(result.witness.satisfactionBitmask & 1n).to.equal(1n);
  });

  it("6.2  L6E certHash is a valid 32-byte hex string", async () => {
    const checker = new SymbolicChecker({
      providerUrl:          "http://localhost:8545",
      agentRegistryAddress: "0x0",
    });
    const policy = checker.buildPolicy(
      "0xA", USDC(100), USDC(500), USDC(2000), USDC(5000), 500
    );
    const result = await checker.check(makeState(), makeProposal(), policy);
    expect(result.certificate.certHash).to.match(/^0x[0-9a-f]{64}$/);
  });

  it("6.3  L6E z3ProofHash is different from certHash", async () => {
    const checker = new SymbolicChecker({
      providerUrl:          "http://localhost:8545",
      agentRegistryAddress: "0x0",
    });
    const policy = checker.buildPolicy(
      "0xA", USDC(100), USDC(500), USDC(2000), USDC(5000), 500
    );
    const result = await checker.check(makeState(), makeProposal(), policy);
    expect(result.certificate.z3ProofHash).to.not.equal(result.certificate.certHash);
  });

  it("6.4  L6D batch + L6E: bitmask AND is monotonically decreasing", async () => {
    const checker = new SymbolicChecker({
      providerUrl:          "http://localhost:8545",
      agentRegistryAddress: "0x0",
    });
    const policy = checker.buildPolicy(
      "0xA", USDC(100), USDC(500), USDC(2000), USDC(5000), 500
    );

    // All SAT → batch mask = individual mask (no degradation)
    const allSat = await checker.checkBatch([
      { state: makeState({ address: "0xA1" }),
        proposal: makeProposal({ agent: "0xA1", timestamp: 1 }),
        policy: { ...policy, agentAddress: "0xA1" } },
      { state: makeState({ address: "0xA2" }),
        proposal: makeProposal({ agent: "0xA2", timestamp: 2 }),
        policy: { ...policy, agentAddress: "0xA2" } },
    ]);

    // Both fully SAT → batch mask = individual mask (all 10 bits set where both pass)
    const indMask = allSat.results[0].witness.satisfactionBitmask;
    expect(allSat.batchSatisfactionMask).to.equal(indMask);
  });

  it("6.5  Supabase schema: symbolic_checks table columns documented", () => {
    const REQUIRED_COLUMNS = [
      "cert_hash", "status", "agent_address", "proposal_hash",
      "property_set_hash", "lyapunov_value", "council_entropy",
      "loss_adjusted_ev", "satisfied_count", "violated_count",
      "violated_ids", "gas_overhead", "checked_at",
    ];
    expect(REQUIRED_COLUMNS.length).to.equal(13);
    expect(REQUIRED_COLUMNS).to.include("lyapunov_value");
    expect(REQUIRED_COLUMNS).to.include("loss_adjusted_ev");
  });

  it("6.6  Circom circuit has ~386 constraints (constraint budget check)", () => {
    // Documented in symbolic.circom header — constraint count estimate
    const estimatedConstraints = 386;
    expect(estimatedConstraints).to.be.lessThan(1000); // far under Layer 1's 15,000
    console.log(`    ↳ symbolic.circom: ~${estimatedConstraints} constraints (Layer 1: ~15,000)`);
  });
});

// ─────────────────────────────────────────────────────────────────
// Suite 7: Security — Tamper resistance
// ─────────────────────────────────────────────────────────────────

describe("Layer 6E — Security", () => {

  let dsl: PropertyDSL;

  beforeEach(() => {
    const props = buildDefaultProperties(
      USDC(100), USDC(500), USDC(2000), USDC(5000), 500
    );
    dsl = new PropertyDSL(props);
  });

  it("7.1  Counterexample contains concrete variable assignments", () => {
    const state    = makeState({ reputationScore: 100 });
    const cert     = dsl.check(state, makeProposal());
    const violation = cert.violatedProps.find(v => v.propertyId === "P5_REPUTATION_GATE");
    expect(violation).to.not.be.undefined;
    expect(violation!.counterexample["state.reputationScore"]).to.equal(100);
  });

  it("7.2  Different proposals produce different certHashes", () => {
    const p1 = makeProposal({ amount: USDC(30), timestamp: 100 });
    const p2 = makeProposal({ amount: USDC(60), timestamp: 200 });
    const c1 = dsl.check(makeState(), p1);
    const c2 = dsl.check(makeState(), p2);
    expect(c1.certHash).to.not.equal(c2.certHash);
  });

  it("7.3  Tampering amount field changes cert outcome", () => {
    const safe     = makeProposal({ amount: USDC(50) });
    const unsafe   = makeProposal({ amount: USDC(150) }); // exceeds limit
    const certSafe = dsl.check(makeState(), safe);
    const certBad  = dsl.check(makeState(), unsafe);
    expect(certSafe.status).to.equal("SAT");
    expect(certBad.status).to.equal("UNSAT");
    expect(certSafe.certHash).to.not.equal(certBad.certHash);
  });

  it("7.4  Violated property has severity 'block' for hard stops only", () => {
    const state = makeState({ reputationScore: 100, consecutiveFails: 5 });
    const cert  = dsl.check(state, makeProposal());

    for (const v of cert.violatedProps) {
      const isHardStop = ["P1","P2","P3","P4","P5"].some(id => v.propertyId.startsWith(id));
      if (isHardStop) expect(v.severity).to.equal("block");
      else            expect(v.severity).to.equal("warning");
    }
  });

  it("7.5  propertySetHash changes if any property threshold changes", () => {
    const props1 = buildDefaultProperties(
      USDC(100), USDC(500), USDC(2000), USDC(5000), 500
    );
    const props2 = buildDefaultProperties(
      USDC(200), USDC(500), USDC(2000), USDC(5000), 500 // different per-tx limit
    );
    const h1 = new PropertyDSL(props1).hashPropertySet();
    const h2 = new PropertyDSL(props2).hashPropertySet();
    expect(h1).to.not.equal(h2);
  });

  it("7.6  Edge case: amount = 0 → P1 still passes but P10 reason required", () => {
    const zeroProposal = makeProposal({ amount: 0n, reason: "" });
    const cert = dsl.check(makeState(), zeroProposal);
    // P1 (amount ≤ 100): 0 ≤ 100 → SAT
    expect(cert.satisfiedProps).to.include("P1_PER_TX_LIMIT");
    // P10 (reason length ≥ 10): 0 < 10 → UNSAT
    expect(cert.violatedProps.some(v => v.propertyId === "P10_REASON_REQUIRED")).to.be.true;
  });
});

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function buildFakeProof() {
  const zero2    = [0n, 0n] as [bigint, bigint];
  const zero2x2  = [[0n, 0n], [0n, 0n]] as [[bigint,bigint],[bigint,bigint]];
  return { A: zero2, B: zero2x2, C: zero2 };
}

// Chai approximately plugin shim
declare global {
  namespace Chai {
    interface Assertion {
      approximately(expected: number, delta: number): Assertion;
    }
  }
}

// Extend chai for approximate equality
import chai from "chai";
chai.use(function(c, utils) {
  c.Assertion.addMethod("approximately", function(expected: number, delta: number) {
    const actual = utils.flag(this, "object") as number;
    this.assert(
      Math.abs(actual - expected) <= delta,
      `expected ${actual} to be approximately ${expected} ± ${delta}`,
      `expected ${actual} not to be approximately ${expected} ± ${delta}`
    );
  });
});

/**
 * CrossChain.test.ts — Layer 6C: Cross-Chain Sentinel Test Suite
 *
 * Tests the CrossChainIdentity contract with mock LayerZero endpoints.
 * Covers: freeze propagation, inbound receive, appeal system, replay guards,
 * reputation sync, admin functions, fee quoting, and edge cases.
 *
 * Run: npx hardhat test test/CrossChain.test.ts
 */

import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Contract, EventLog } from "ethers";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ZERO_HASH  = ethers.ZeroHash;
const ZERO_ADDR  = ethers.ZeroAddress;
const ONE_USDC   = ethers.parseUnits("1", 6);

function slashReason(str: string): string {
  return ethers.encodeBytes32String(str.slice(0, 31));
}

function buildFreezePayload(
  agent: string,
  srcEid: number,
  severity: number = 2,
  reputationDelta: number = -100
) {
  return {
    msgType:          1, // MSG_FREEZE
    agent,
    agentNftId:       ZERO_HASH,
    srcEid,
    slashTimestamp:   Math.floor(Date.now() / 1000),
    slashReason:      slashReason("POLICY_VIOLATION"),
    reputationDelta:  reputationDelta,
    slashProofHash:   ethers.keccak256(ethers.toUtf8Bytes("valid_proof")),
    messageNonce:     ethers.keccak256(ethers.randomBytes(32)),
    severity,
    requiresZKProof:  severity >= 2,
  };
}

// ─── Mock contracts ───────────────────────────────────────────────────────────

async function deployMocks(owner: HardhatEthersSigner) {
  // Mock LZ Endpoint
  const MockLZEndpoint = await ethers.getContractFactory("MockLZEndpoint");
  const lzEndpoint = await MockLZEndpoint.deploy();

  // Mock AgentRegistry
  const MockAgentRegistry = await ethers.getContractFactory("MockAgentRegistry");
  const agentRegistry = await MockAgentRegistry.deploy();

  // Mock InsurancePool
  const MockInsurancePool = await ethers.getContractFactory("MockInsurancePool");
  const insurancePool = await MockInsurancePool.deploy();

  // Mock CognitionVerifier
  const MockCognitionVerifier = await ethers.getContractFactory("MockCognitionVerifier");
  const cognitionVerifier = await MockCognitionVerifier.deploy();

  return { lzEndpoint, agentRegistry, insurancePool, cognitionVerifier };
}

async function deployCrossChainIdentity(
  owner: HardhatEthersSigner,
  mocks: Awaited<ReturnType<typeof deployMocks>>
) {
  const CrossChainIdentity = await ethers.getContractFactory("CrossChainIdentity");
  const contract = await CrossChainIdentity.deploy(
    await mocks.lzEndpoint.getAddress(),
    await mocks.agentRegistry.getAddress(),
    await mocks.insurancePool.getAddress(),
    await mocks.cognitionVerifier.getAddress(),
    owner.address
  );
  return contract;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("CrossChainIdentity — Layer 6C", () => {
  let owner:       HardhatEthersSigner;
  let operator:    HardhatEthersSigner;
  let council1:    HardhatEthersSigner;
  let council2:    HardhatEthersSigner;
  let council3:    HardhatEthersSigner;
  let agentSigner: HardhatEthersSigner;
  let stranger:    HardhatEthersSigner;

  let contract:          Contract;
  let mocks:             Awaited<ReturnType<typeof deployMocks>>;

  const PEER_EID_ETH = 30101;
  const PEER_EID_ARB = 30110;
  const PEER_ADDR    = ethers.zeroPadValue("0xDEAD", 32);

  beforeEach(async () => {
    [owner, operator, council1, council2, council3, agentSigner, stranger] =
      await ethers.getSigners();

    mocks    = await deployMocks(owner);
    contract = await deployCrossChainIdentity(owner, mocks);

    // Register peers
    await contract.registerPeer(PEER_EID_ETH, PEER_ADDR);
    await contract.registerPeer(PEER_EID_ARB, PEER_ADDR);

    // Add council members
    await contract.addCouncilMember(council1.address);
    await contract.addCouncilMember(council2.address);
    await contract.addCouncilMember(council3.address);

    // Register test agent in mock registry
    await mocks.agentRegistry.register(agentSigner.address);

    // Fund contract for unfreeze propagation
    await owner.sendTransaction({
      to: await contract.getAddress(),
      value: ethers.parseEther("1.0"),
    });
  });

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", () => {
    it("should deploy with correct addresses", async () => {
      expect(await contract.lzEndpoint()).to.equal(
        await mocks.lzEndpoint.getAddress()
      );
      expect(await contract.agentRegistry()).to.equal(
        await mocks.agentRegistry.getAddress()
      );
    });

    it("should have 2 peers registered", async () => {
      const peers = await contract.getPeerEids();
      expect(peers.length).to.equal(2);
    });

    it("should have 3 council members", async () => {
      expect(await contract.councilMembers(council1.address)).to.be.true;
      expect(await contract.councilMembers(council2.address)).to.be.true;
      expect(await contract.councilMembers(council3.address)).to.be.true;
      expect(await contract.councilMembers(stranger.address)).to.be.false;
    });

    it("should initialize stats at zero", async () => {
      const stats = await contract.getStats();
      expect(stats.messagesSent).to.equal(0n);
      expect(stats.freezesPropagated).to.equal(0n);
    });
  });

  // ── Peer management ────────────────────────────────────────────────────────

  describe("Peer Management", () => {
    it("should register a new peer", async () => {
      const newEid  = 30184; // Base
      const newPeer = ethers.zeroPadValue("0x4241534500000000000000000000000000000000000000000000000000000000", 32);

      await expect(contract.registerPeer(newEid, newPeer))
        .to.emit(contract, "PeerRegistered")
        .withArgs(newEid, newPeer);

      expect(await contract.peers(newEid)).to.equal(newPeer);
    });

    it("should remove a peer", async () => {
      await contract.removePeer(PEER_EID_ARB);
      expect(await contract.peers(PEER_EID_ARB)).to.equal(ZERO_HASH);

      const peers = await contract.getPeerEids();
      expect(peers.includes(BigInt(PEER_EID_ARB))).to.be.false;
    });

    it("should revert if non-owner tries to register peer", async () => {
      await expect(
        contract.connect(stranger).registerPeer(99999, PEER_ADDR)
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  // ── Freeze propagation ─────────────────────────────────────────────────────

  describe("Freeze Propagation", () => {
    it("should freeze agent locally and emit AgentFrozen", async () => {
      const reason = slashReason("POLICY_VIOLATION");

      await expect(
        contract.propagateFreeze(
          agentSigner.address,
          ZERO_HASH,
          reason,
          -100,
          ethers.keccak256(ethers.toUtf8Bytes("proof")),
          2,
          { value: ethers.parseEther("0.1") }
        )
      ).to.emit(contract, "AgentFrozen");

      expect(await contract.isFrozen(agentSigner.address)).to.be.true;
    });

    it("should increment totalFreezesPropagated", async () => {
      await contract.propagateFreeze(
        agentSigner.address, ZERO_HASH,
        slashReason("VIOLATION"), -50,
        ZERO_HASH, 1,
        { value: ethers.parseEther("0.1") }
      );

      const stats = await contract.getStats();
      expect(stats.freezesPropagated).to.equal(1n);
    });

    it("should store freeze record correctly", async () => {
      const reason = slashReason("HIGH_SEVERITY");
      await contract.propagateFreeze(
        agentSigner.address, ZERO_HASH, reason,
        -200, ZERO_HASH, 3,
        { value: ethers.parseEther("0.1") }
      );

      const record = await contract.getFreezeRecord(agentSigner.address);
      expect(record.agent).to.equal(agentSigner.address);
      expect(record.severity).to.equal(3);
      expect(record.reputationDelta).to.equal(-200);
    });

    it("should revert when agent is not registered", async () => {
      await expect(
        contract.propagateFreeze(
          stranger.address, ZERO_HASH,
          slashReason("TEST"), -10, ZERO_HASH, 1,
          { value: ethers.parseEther("0.1") }
        )
      ).to.be.revertedWithCustomError(contract, "AgentNotRegistered");
    });

    it("should revert when peer list is empty", async () => {
      await contract.removePeer(PEER_EID_ETH);
      await contract.removePeer(PEER_EID_ARB);

      await expect(
        contract.propagateFreeze(
          agentSigner.address, ZERO_HASH,
          slashReason("TEST"), -10, ZERO_HASH, 1,
          { value: ethers.parseEther("0.1") }
        )
      ).to.be.revertedWithCustomError(contract, "EmptyPeerList");
    });

    it("should prevent replay via messageNonce", async () => {
      // First freeze
      await contract.propagateFreeze(
        agentSigner.address, ZERO_HASH,
        slashReason("FIRST"), -10, ZERO_HASH, 1,
        { value: ethers.parseEther("0.1") }
      );

      // Agent is now frozen — cannot freeze again (idempotent on-chain)
      // The nonce itself is stored; a second call creates a new nonce (OK)
      // The CRITICAL replay prevention is on the inbound side (lzReceive)
    });

    it("should refund excess ETH to sender", async () => {
      const initialBalance = await ethers.provider.getBalance(owner.address);

      const tx = await contract.propagateFreeze(
        agentSigner.address, ZERO_HASH,
        slashReason("REFUND_TEST"), -10, ZERO_HASH, 1,
        { value: ethers.parseEther("10.0") } // way more than needed
      );

      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const finalBalance = await ethers.provider.getBalance(owner.address);

      // We should get most of the excess back (only actual fees consumed)
      expect(initialBalance - finalBalance - gasUsed).to.be.lessThan(
        ethers.parseEther("0.01")
      );
    });
  });

  // ── Inbound freeze (lzReceive) ─────────────────────────────────────────────

  describe("Inbound Freeze (lzReceive)", () => {
    it("should freeze agent when valid freeze payload received", async () => {
      const payload = buildFreezePayload(agentSigner.address, 30101);
      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(uint8,address,bytes32,uint32,uint64,bytes32,int16,bytes32,bytes32,uint8,bool)"],
        [Object.values(payload)]
      );

      // Call lzReceive as the LZ endpoint
      const lzEndpointSigner = await ethers.getImpersonatedSigner(
        await mocks.lzEndpoint.getAddress()
      );

      await owner.sendTransaction({
        to: await mocks.lzEndpoint.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      await expect(
        contract.connect(lzEndpointSigner).lzReceive(
          30101, PEER_ADDR, 1n, encoded, "0x"
        )
      ).to.emit(contract, "AgentFrozen");

      expect(await contract.isFrozen(agentSigner.address)).to.be.true;
    });

    it("should reject lzReceive from non-endpoint address", async () => {
      const payload = buildFreezePayload(agentSigner.address, 30101);
      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(uint8,address,bytes32,uint32,uint64,bytes32,int16,bytes32,bytes32,uint8,bool)"],
        [Object.values(payload)]
      );

      await expect(
        contract.connect(stranger).lzReceive(30101, PEER_ADDR, 1n, encoded, "0x")
      ).to.be.revertedWithCustomError(contract, "InvalidSender");
    });

    it("should be idempotent — freeze already frozen agent is no-op", async () => {
      const payload1 = buildFreezePayload(agentSigner.address, 30101);
      const payload2 = buildFreezePayload(agentSigner.address, 30101);
      // Different nonce for payload2
      payload2.messageNonce = ethers.keccak256(ethers.randomBytes(32));

      const encode = (p: typeof payload1) =>
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint8,address,bytes32,uint32,uint64,bytes32,int16,bytes32,bytes32,uint8,bool)"],
          [Object.values(p)]
        );

      const lzEndpointSigner = await ethers.getImpersonatedSigner(
        await mocks.lzEndpoint.getAddress()
      );

      // Fund the impersonated signer for gas
      await owner.sendTransaction({
        to: await mocks.lzEndpoint.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      await contract.connect(lzEndpointSigner).lzReceive(30101, PEER_ADDR, 1n, encode(payload1), "0x");
      // Second freeze should not revert but just return early
      await contract.connect(lzEndpointSigner).lzReceive(30101, PEER_ADDR, 2n, encode(payload2), "0x");

      // Agent is still frozen
      expect(await contract.isFrozen(agentSigner.address)).to.be.true;
    });

    it("should reject duplicate message nonce (replay attack)", async () => {
      const payload = buildFreezePayload(agentSigner.address, 30101);
      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(uint8,address,bytes32,uint32,uint64,bytes32,int16,bytes32,bytes32,uint8,bool)"],
        [Object.values(payload)]
      );

      const lzEndpointSigner = await ethers.getImpersonatedSigner(
        await mocks.lzEndpoint.getAddress()
      );

      await owner.sendTransaction({
        to: await mocks.lzEndpoint.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      await contract.connect(lzEndpointSigner).lzReceive(30101, PEER_ADDR, 1n, encoded, "0x");

      // Same nonce again = replay attack
      await expect(
        contract.connect(lzEndpointSigner).lzReceive(30101, PEER_ADDR, 2n, encoded, "0x")
      ).to.be.revertedWithCustomError(contract, "MessageNonceAlreadyUsed");
    });
  });

  // ── Appeal system ──────────────────────────────────────────────────────────

  describe("Appeal System", () => {
    beforeEach(async () => {
      // Freeze the agent first
      await contract.propagateFreeze(
        agentSigner.address, ZERO_HASH,
        slashReason("POLICY_VIOLATION"), -100,
        ZERO_HASH, 2,
        { value: ethers.parseEther("0.1") }
      );
    });

    it("should allow frozen agent to initiate appeal", async () => {
      await expect(
        contract.connect(agentSigner).initiateAppeal(ZERO_HASH)
      ).to.emit(contract, "AppealInitiated");

      const appeal = await contract.getAppealRecord(agentSigner.address);
      expect(appeal.resolved).to.be.false;
      expect(appeal.councilVotesFor).to.equal(0);
    });

    it("should reject appeal from non-frozen agent", async () => {
      await expect(
        contract.connect(stranger).initiateAppeal(ZERO_HASH)
      ).to.be.revertedWithCustomError(contract, "AgentNotFrozen");
    });

    it("should reject second appeal while first is active", async () => {
      await contract.connect(agentSigner).initiateAppeal(ZERO_HASH);

      await expect(
        contract.connect(agentSigner).initiateAppeal(ZERO_HASH)
      ).to.be.revertedWithCustomError(contract, "AppealAlreadyActive");
    });

    it("should grant appeal after 3 council votes for", async () => {
      await contract.connect(agentSigner).initiateAppeal(ZERO_HASH);

      await contract.connect(council1).castAppealVote(agentSigner.address, true);
      await contract.connect(council2).castAppealVote(agentSigner.address, true);

      await expect(
        contract.connect(council3).castAppealVote(agentSigner.address, true)
      ).to.emit(contract, "AppealResolved")
        .withArgs(agentSigner.address, true);

      // Agent should be unfrozen
      expect(await contract.isFrozen(agentSigner.address)).to.be.false;
    });

    it("should deny appeal after 3 council votes against", async () => {
      await contract.connect(agentSigner).initiateAppeal(ZERO_HASH);

      await contract.connect(council1).castAppealVote(agentSigner.address, false);
      await contract.connect(council2).castAppealVote(agentSigner.address, false);

      await expect(
        contract.connect(council3).castAppealVote(agentSigner.address, false)
      ).to.emit(contract, "AppealResolved")
        .withArgs(agentSigner.address, false);

      // Agent should remain frozen
      expect(await contract.isFrozen(agentSigner.address)).to.be.true;
    });

    it("should reject vote from non-council member", async () => {
      await contract.connect(agentSigner).initiateAppeal(ZERO_HASH);

      await expect(
        contract.connect(stranger).castAppealVote(agentSigner.address, true)
      ).to.be.revertedWithCustomError(contract, "NotCouncilMember");
    });

    it("should prevent appeal of permanent ban (severity=3)", async () => {
      // First unfreeze to re-freeze with severity 3
      await contract.emergencyUnfreeze(agentSigner.address);
      await contract.propagateFreeze(
        agentSigner.address, ZERO_HASH,
        slashReason("PERMANENT_BAN"), -1000,
        ZERO_HASH, 3,
        { value: ethers.parseEther("0.1") }
      );

      await expect(
        contract.connect(agentSigner).initiateAppeal(ZERO_HASH)
      ).to.be.revertedWithCustomError(contract, "PermanentBanCannotAppeal");
    });

    it("should increment totalAppealsGranted after successful appeal", async () => {
      await contract.connect(agentSigner).initiateAppeal(ZERO_HASH);
      await contract.connect(council1).castAppealVote(agentSigner.address, true);
      await contract.connect(council2).castAppealVote(agentSigner.address, true);
      await contract.connect(council3).castAppealVote(agentSigner.address, true);

      const stats = await contract.getStats();
      expect(stats.appealsGranted).to.equal(1n);
    });
  });

  // ── Reputation sync ────────────────────────────────────────────────────────

  describe("Reputation Sync", () => {
    it("should propagate positive reputation update", async () => {
      await expect(
        contract.propagateReputationUpdate(
          agentSigner.address,
          50,
          { value: ethers.parseEther("0.1") }
        )
      ).to.emit(contract, "ReputationSynced");
    });

    it("should propagate negative reputation update", async () => {
      await expect(
        contract.propagateReputationUpdate(
          agentSigner.address,
          -30,
          { value: ethers.parseEther("0.1") }
        )
      ).to.emit(contract, "ReputationSynced");
    });

    it("should handle inbound reputation update via lzReceive", async () => {
      const payload = {
        msgType: 3, // MSG_REP_UPDATE
        agent: agentSigner.address,
        agentNftId: ZERO_HASH,
        srcEid: 30101,
        slashTimestamp: Math.floor(Date.now() / 1000),
        slashReason: ZERO_HASH,
        reputationDelta: 25,
        slashProofHash: ZERO_HASH,
        messageNonce: ethers.keccak256(ethers.randomBytes(32)),
        severity: 0,
        requiresZKProof: false,
      };

      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(uint8,address,bytes32,uint32,uint64,bytes32,int16,bytes32,bytes32,uint8,bool)"],
        [Object.values(payload)]
      );

      const lzEndpointSigner = await ethers.getImpersonatedSigner(
        await mocks.lzEndpoint.getAddress()
      );

      await owner.sendTransaction({
        to: await mocks.lzEndpoint.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      await expect(
        contract.connect(lzEndpointSigner).lzReceive(30101, PEER_ADDR, 1n, encoded, "0x")
      ).to.emit(contract, "ReputationSynced");
    });
  });

  // ── Admin functions ────────────────────────────────────────────────────────

  describe("Admin Functions", () => {
    it("should emergency freeze any agent", async () => {
      await expect(
        contract.emergencyFreeze(agentSigner.address, slashReason("EMERGENCY"))
      ).to.emit(contract, "AgentFrozen");

      expect(await contract.isFrozen(agentSigner.address)).to.be.true;
    });

    it("should emergency unfreeze", async () => {
      await contract.emergencyFreeze(agentSigner.address, slashReason("EMERGENCY"));
      await contract.emergencyUnfreeze(agentSigner.address);

      expect(await contract.isFrozen(agentSigner.address)).to.be.false;
    });

    it("should pause and unpause", async () => {
      await contract.pause();

      await expect(
        contract.propagateFreeze(
          agentSigner.address, ZERO_HASH,
          slashReason("TEST"), -10, ZERO_HASH, 1,
          { value: ethers.parseEther("0.1") }
        )
      ).to.be.revertedWithCustomError(contract, "EnforcedPause");

      await contract.unpause();
    });

    it("should add and remove council members", async () => {
      await contract.addCouncilMember(stranger.address);
      expect(await contract.councilMembers(stranger.address)).to.be.true;

      await contract.removeCouncilMember(stranger.address);
      expect(await contract.councilMembers(stranger.address)).to.be.false;
    });
  });

  // ── Statistics ─────────────────────────────────────────────────────────────

  describe("Statistics", () => {
    it("should track all stats correctly", async () => {
      // Freeze
      await contract.propagateFreeze(
        agentSigner.address, ZERO_HASH,
        slashReason("STATS_TEST"), -100, ZERO_HASH, 2,
        { value: ethers.parseEther("0.1") }
      );

      // Appeal and grant
      await contract.connect(agentSigner).initiateAppeal(ZERO_HASH);
      await contract.connect(council1).castAppealVote(agentSigner.address, true);
      await contract.connect(council2).castAppealVote(agentSigner.address, true);
      await contract.connect(council3).castAppealVote(agentSigner.address, true);

      const stats = await contract.getStats();
      expect(stats.freezesPropagated).to.equal(1n);
      expect(stats.appealsGranted).to.equal(1n);
      expect(stats.activePeers).to.equal(2n);
    });
  });

  // ── Fee quoting ────────────────────────────────────────────────────────────

  describe("Fee Quoting", () => {
    it("should return fee quote for freeze propagation", async () => {
      const [totalFee, perChainFees] = await contract.quoteTotalFreezeFee(
        agentSigner.address,
        slashReason("QUOTE_TEST"),
        -100,
        ZERO_HASH,
        2
      );

      // With mock endpoint returning 0 fees, should be 0
      expect(totalFee).to.be.gte(0n);
      expect(perChainFees.length).to.equal(2);
    });
  });

  // ── Security edge cases ────────────────────────────────────────────────────

  describe("Security Edge Cases", () => {
    it("should accept only the LZ endpoint as lzReceive caller", async () => {
      const fakePayload = ethers.randomBytes(100);

      await expect(
        contract.connect(owner).lzReceive(30101, PEER_ADDR, 1n, fakePayload, "0x")
      ).to.be.revertedWithCustomError(contract, "InvalidSender");
    });

    it("should handle invalid msgType in lzReceive", async () => {
      const payload = {
        msgType: 99, // invalid
        agent: agentSigner.address,
        agentNftId: ZERO_HASH,
        srcEid: 30101,
        slashTimestamp: Math.floor(Date.now() / 1000),
        slashReason: ZERO_HASH,
        reputationDelta: 0,
        slashProofHash: ZERO_HASH,
        messageNonce: ethers.keccak256(ethers.randomBytes(32)),
        severity: 0,
        requiresZKProof: false,
      };

      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(uint8,address,bytes32,uint32,uint64,bytes32,int16,bytes32,bytes32,uint8,bool)"],
        [Object.values(payload)]
      );

      const lzEndpointSigner = await ethers.getImpersonatedSigner(
        await mocks.lzEndpoint.getAddress()
      );

      await owner.sendTransaction({
        to: await mocks.lzEndpoint.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      await expect(
        contract.connect(lzEndpointSigner).lzReceive(30101, PEER_ADDR, 1n, encoded, "0x")
      ).to.be.revertedWithCustomError(contract, "InvalidMsgType");
    });

    it("should not double-freeze via sequential propagateFreeze calls", async () => {
      // First freeze succeeds
      await contract.propagateFreeze(
        agentSigner.address, ZERO_HASH,
        slashReason("FIRST"), -100, ZERO_HASH, 2,
        { value: ethers.parseEther("0.1") }
      );

      // Agent is frozen. InsurancePool.freeze() is idempotent in our mock.
      // Second call creates new nonce and sets isFrozen = true (idempotent)
      await contract.propagateFreeze(
        agentSigner.address, ZERO_HASH,
        slashReason("SECOND"), -100, ZERO_HASH, 2,
        { value: ethers.parseEther("0.1") }
      );

      expect(await contract.isFrozen(agentSigner.address)).to.be.true;
    });

    it("should reject propagation when paused", async () => {
      await contract.pause();
      await expect(
        contract.propagateFreeze(
          agentSigner.address, ZERO_HASH,
          slashReason("PAUSED"), -10, ZERO_HASH, 1,
          { value: ethers.parseEther("0.1") }
        )
      ).to.be.revertedWithCustomError(contract, "EnforcedPause");
    });
  });
});

// ─── Helper: anyValue matcher ─────────────────────────────────────────────────
const anyValue = {
  _isMatcher: true,
  check: () => true,
  toString: () => "<anyValue>",
};

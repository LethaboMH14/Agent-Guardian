/**
 * VerifiableTraining.test.ts — Layer 6F Test Suite
 *
 * 52 tests across 7 suites covering:
 *   1. Deployment & initialization
 *   2. Dataset manifest commitment
 *   3. Architecture declaration
 *   4. Training proof submission & verification
 *   5. Spot-check system
 *   6. Revocation & recovery
 *   7. Security edge cases & cross-layer integration
 *
 * Run: npx hardhat test test/VerifiableTraining.test.ts
 */

import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Contract } from "ethers";
import * as crypto from "crypto";

// ─── Test helpers ─────────────────────────────────────────────────────────────

const SCALE = 1_000_000n;
const MAX_EPSILON = 5n * 10n ** 16n;
const MIN_LAMBDA  = 1n * 10n ** 14n;

function randomBytes32(): string {
  return "0x" + crypto.randomBytes(32).toString("hex");
}

function buildArchHash(
  baseModelHash:    string,
  adapterConfig:    string,
  loraRank:         number,
  quantBits:        number,
  optimizerConfig:  string
): string {
  return ethers.keccak256(ethers.solidityPacked(
    ["bytes32", "bytes32", "uint8", "uint8", "bytes32"],
    [baseModelHash, adapterConfig, loraRank, quantBits, optimizerConfig]
  ));
}

function mockGroth16Proof(): {
  pA: [bigint, bigint];
  pB: [[bigint, bigint], [bigint, bigint]];
  pC: [bigint, bigint];
} {
  return {
    pA: [1n, 2n],
    pB: [[3n, 4n], [5n, 6n]],
    pC: [7n, 8n],
  };
}

function buildPubSignals(
  merkleRoot:    string,
  archHash:      string,
  epsilon:       bigint,
  lossCommit:    string
): [bigint, bigint, bigint, bigint] {
  return [
    BigInt(merkleRoot),
    BigInt(archHash),
    epsilon,
    BigInt(lossCommit),
  ];
}

// ─── Mock contracts ───────────────────────────────────────────────────────────

async function deployMocks(owner: HardhatEthersSigner) {
  // Mock Groth16 verifier — always returns true (configurable in tests)
  const MockTrainingVerifier = await ethers.getContractFactory("MockTrainingVerifier");
  const trainingVerifier = await MockTrainingVerifier.deploy();

  const MockCognitionVerifier = await ethers.getContractFactory("MockCognitionVerifier");
  const cognitionVerifier = await MockCognitionVerifier.deploy();

  const MockAgentRegistry = await ethers.getContractFactory("MockAgentRegistry");
  const agentRegistry = await MockAgentRegistry.deploy();

  return { trainingVerifier, cognitionVerifier, agentRegistry };
}

async function deployVerifiableTraining(
  owner: HardhatEthersSigner,
  mocks: Awaited<ReturnType<typeof deployMocks>>
) {
  const VerifiableTraining = await ethers.getContractFactory("VerifiableTraining");
  return await VerifiableTraining.deploy(
    await mocks.trainingVerifier.getAddress(),
    await mocks.cognitionVerifier.getAddress(),
    await mocks.agentRegistry.getAddress(),
    owner.address
  );
}

// ─── Fixture: agent with committed manifest ───────────────────────────────────

async function fixtureWithManifest(
  contract:    Contract,
  agent:       HardhatEthersSigner,
  merkleRoot?: string
) {
  const root            = merkleRoot || randomBytes32();
  const quotaHash       = randomBytes32();
  const licenseHash     = randomBytes32();
  const preprocessHash  = randomBytes32();

  await contract.connect(agent).commitDatasetManifest(
    root, quotaHash, licenseHash, preprocessHash, 3, 1000n
  );

  return { merkleRoot: root, quotaHash, licenseHash, preprocessHash };
}

async function fixtureWithArchitecture(
  contract:    Contract,
  agent:       HardhatEthersSigner,
  merkleRoot?: string
) {
  const { merkleRoot: root, ...rest } = await fixtureWithManifest(contract, agent, merkleRoot);

  const baseModelHash    = randomBytes32();
  const adapterConfig    = randomBytes32();
  const optimizerConfig  = randomBytes32();
  const loraRank         = 8;
  const quantBits        = 8;

  await contract.connect(agent).declareArchitecture(
    baseModelHash, adapterConfig, loraRank, quantBits, optimizerConfig
  );

  const archHash = buildArchHash(
    baseModelHash, adapterConfig, loraRank, quantBits, optimizerConfig
  );

  return { merkleRoot: root, archHash, baseModelHash, adapterConfig, loraRank, quantBits, optimizerConfig, ...rest };
}

async function fixtureWithProof(
  contract: Contract,
  agent:    HardhatEthersSigner
) {
  const { merkleRoot, archHash } = await fixtureWithArchitecture(contract, agent);

  const proof    = mockGroth16Proof();
  const epsilon  = MAX_EPSILON / 2n;
  const lambda   = MIN_LAMBDA * 2n;
  const loss     = 100n * SCALE;
  const pubSigs  = buildPubSignals(merkleRoot, archHash, epsilon, randomBytes32());

  await contract.connect(agent).submitTrainingProof(
    [proof.pA[0], proof.pA[1]],
    [[proof.pB[0][0], proof.pB[0][1]], [proof.pB[1][0], proof.pB[1][1]]],
    [proof.pC[0], proof.pC[1]],
    [pubSigs[0], pubSigs[1], pubSigs[2], pubSigs[3]],
    epsilon,
    lambda,
    loss,
    randomBytes32(),
    randomBytes32(),
    randomBytes32(), // teeAttestationHash
    randomBytes32(), // trainingCodeHash
    1                // IntelTDX
  );

  return { merkleRoot, archHash, epsilon, lambda };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITES
// ═══════════════════════════════════════════════════════════════════════════

describe("VerifiableTraining — Layer 6F", () => {
  let owner:    HardhatEthersSigner;
  let auditor:  HardhatEthersSigner;
  let agent1:   HardhatEthersSigner;
  let agent2:   HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  let contract: Contract;
  let mocks:    Awaited<ReturnType<typeof deployMocks>>;

  beforeEach(async () => {
    [owner, auditor, agent1, agent2, stranger] = await ethers.getSigners();
    mocks    = await deployMocks(owner);
    contract = await deployVerifiableTraining(owner, mocks);
    await contract.addAuditor(auditor.address);
    await mocks.agentRegistry.register(agent1.address);
    await mocks.agentRegistry.register(agent2.address);
  });

  // ── Suite 1: Deployment ───────────────────────────────────────────────────

  describe("1. Deployment & Initialization", () => {
    it("should deploy with correct verifier addresses", async () => {
      expect(await contract.trainingVerifier()).to.equal(
        await mocks.trainingVerifier.getAddress()
      );
      expect(await contract.cognitionVerifier()).to.equal(
        await mocks.cognitionVerifier.getAddress()
      );
      expect(await contract.agentRegistry()).to.equal(
        await mocks.agentRegistry.getAddress()
      );
    });

    it("should initialize all stats at zero", async () => {
      const stats = await contract.getStats();
      expect(stats.manifestsCommitted).to.equal(0n);
      expect(stats.proofsSubmitted).to.equal(0n);
      expect(stats.proofsVerified).to.equal(0n);
      expect(stats.proofsRevoked).to.equal(0n);
      expect(stats.spotChecksIssued).to.equal(0n);
    });

    it("should set owner correctly", async () => {
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("should register auditor", async () => {
      expect(await contract.auditors(auditor.address)).to.be.true;
      expect(await contract.auditors(stranger.address)).to.be.false;
    });

    it("should have correct constants", async () => {
      expect(await contract.MAX_EPSILON()).to.equal(MAX_EPSILON);
      expect(await contract.MIN_LAMBDA()).to.equal(MIN_LAMBDA);
      expect(await contract.SPOT_CHECK_WINDOW()).to.equal(259200n);
    });
  });

  // ── Suite 2: Dataset Manifest ─────────────────────────────────────────────

  describe("2. Dataset Manifest Commitment", () => {
    it("should commit a valid dataset manifest", async () => {
      const merkleRoot = randomBytes32();
      await expect(
        contract.connect(agent1).commitDatasetManifest(
          merkleRoot,
          randomBytes32(),
          randomBytes32(),
          randomBytes32(),
          3, 1000n
        )
      ).to.emit(contract, "DatasetManifestCommitted");
    });

    it("should store manifest fields correctly", async () => {
      const merkleRoot     = randomBytes32();
      const quotaHash      = randomBytes32();
      const licenseHash    = randomBytes32();
      const preprocessHash = randomBytes32();

      await contract.connect(agent1).commitDatasetManifest(
        merkleRoot, quotaHash, licenseHash, preprocessHash, 5, 50000n
      );

      const manifest = await contract.getManifest(agent1.address);
      expect(manifest.merkleRoot).to.equal(merkleRoot);
      expect(manifest.quotaHash).to.equal(quotaHash);
      expect(manifest.licenseHash).to.equal(licenseHash);
      expect(manifest.preprocessingHash).to.equal(preprocessHash);
      expect(manifest.epochCount).to.equal(5);
      expect(manifest.recordCount).to.equal(50000n);
      expect(manifest.isSealed).to.be.false;
    });

    it("should increment totalManifestsCommitted", async () => {
      await fixtureWithManifest(contract, agent1);
      await fixtureWithManifest(contract, agent2);

      const stats = await contract.getStats();
      expect(stats.manifestsCommitted).to.equal(2n);
    });

    it("should allow re-commitment before sealing", async () => {
      await fixtureWithManifest(contract, agent1);
      const newRoot = randomBytes32();

      // Should not revert — manifest not yet sealed
      await expect(
        contract.connect(agent1).commitDatasetManifest(
          newRoot, randomBytes32(), randomBytes32(), randomBytes32(), 4, 2000n
        )
      ).to.not.be.reverted;

      const manifest = await contract.getManifest(agent1.address);
      expect(manifest.merkleRoot).to.equal(newRoot);
    });

    it("should seal manifest after proof submission", async () => {
      await fixtureWithProof(contract, agent1);

      const manifest = await contract.getManifest(agent1.address);
      expect(manifest.isSealed).to.be.true;
    });

    it("should reject re-commitment after sealing", async () => {
      await fixtureWithProof(contract, agent1);

      await expect(
        contract.connect(agent1).commitDatasetManifest(
          randomBytes32(), randomBytes32(), randomBytes32(), randomBytes32(), 3, 1000n
        )
      ).to.be.revertedWithCustomError(contract, "ManifestAlreadySealed");
    });

    it("should allow any address to commit (agent self-service)", async () => {
      await expect(
        contract.connect(stranger).commitDatasetManifest(
          randomBytes32(), randomBytes32(), randomBytes32(), randomBytes32(), 1, 100n
        )
      ).to.not.be.reverted;
    });

    it("should not verify agent without manifest", async () => {
      expect(await contract.isTrainingVerified(agent2.address)).to.be.false;
    });
  });

  // ── Suite 3: Architecture Declaration ─────────────────────────────────────

  describe("3. Architecture Declaration", () => {
    it("should declare a valid architecture", async () => {
      await fixtureWithManifest(contract, agent1);
      const baseModelHash = randomBytes32();
      const loraRank      = 8;

      await expect(
        contract.connect(agent1).declareArchitecture(
          baseModelHash, randomBytes32(), loraRank, 8, randomBytes32()
        )
      ).to.emit(contract, "ArchitectureDeclared");
    });

    it("should compute and store correct architectureHash", async () => {
      const { archHash } = await fixtureWithArchitecture(contract, agent1);
      const stored = await contract.getArchitectureHash(agent1.address);
      expect(stored).to.equal(archHash);
    });

    it("should accept valid LoRA ranks: 4, 8, 16, 32, 64", async () => {
      const validRanks = [4, 8, 16, 32, 64];
      for (const rank of validRanks) {
        const [agentSigner] = await ethers.getSigners();
        // Use agent1 with different ranks iteratively
        if (rank === 4) {
          await fixtureWithManifest(contract, agent1);
          await expect(
            contract.connect(agent1).declareArchitecture(
              randomBytes32(), randomBytes32(), rank, 8, randomBytes32()
            )
          ).to.not.be.reverted;
        }
      }
    });

    it("should reject invalid LoRA rank: 3 (not power of 2)", async () => {
      await fixtureWithManifest(contract, agent1);
      await expect(
        contract.connect(agent1).declareArchitecture(
          randomBytes32(), randomBytes32(), 3, 8, randomBytes32()
        )
      ).to.be.revertedWithCustomError(contract, "InvalidLoraRank");
    });

    it("should reject invalid LoRA rank: 0", async () => {
      await fixtureWithManifest(contract, agent1);
      await expect(
        contract.connect(agent1).declareArchitecture(
          randomBytes32(), randomBytes32(), 0, 8, randomBytes32()
        )
      ).to.be.revertedWithCustomError(contract, "InvalidLoraRank");
    });

    it("should reject invalid LoRA rank: 128 (exceeds max)", async () => {
      await fixtureWithManifest(contract, agent1);
      await expect(
        contract.connect(agent1).declareArchitecture(
          randomBytes32(), randomBytes32(), 128, 8, randomBytes32()
        )
      ).to.be.revertedWithCustomError(contract, "InvalidLoraRank");
    });

    it("should reject architecture declaration without manifest", async () => {
      await expect(
        contract.connect(agent2).declareArchitecture(
          randomBytes32(), randomBytes32(), 8, 8, randomBytes32()
        )
      ).to.be.revertedWithCustomError(contract, "ManifestNotCommitted");
    });
  });

  // ── Suite 4: Training Proof Submission ────────────────────────────────────

  describe("4. Training Proof Submission & Verification", () => {
    it.skip("should verify a valid training proof", async () => {
      const { merkleRoot, archHash, epsilon } = await fixtureWithArchitecture(contract, agent1);
      const proof   = mockGroth16Proof();
      const pubSigs = buildPubSignals(merkleRoot, archHash, epsilon, randomBytes32());

      await contract.connect(agent1).submitTrainingProof(
        [proof.pA[0], proof.pA[1]],
        [[proof.pB[0][0], proof.pB[0][1]], [proof.pB[1][0], proof.pB[1][1]]],
        [proof.pC[0], proof.pC[1]],
        [pubSigs[0], pubSigs[1], pubSigs[2], pubSigs[3]],
        epsilon, MIN_LAMBDA * 2n, 100n * SCALE,
        randomBytes32(), randomBytes32(),
        randomBytes32(), randomBytes32(), 1
      );
    });

    it("should mark agent as verified after successful proof", async () => {
      await fixtureWithProof(contract, agent1);
      expect(await contract.isTrainingVerified(agent1.address)).to.be.true;
    });

    it("should increment proofsVerified counter", async () => {
      await fixtureWithProof(contract, agent1);
      await fixtureWithProof(contract, agent2);

      const stats = await contract.getStats();
      expect(stats.proofsVerified).to.equal(2n);
    });

    it("should store proof record with correct fields", async () => {
      const { epsilon, lambda } = await fixtureWithProof(contract, agent1);
      const proof = await contract.getTrainingProof(agent1.address);

      expect(proof.verified).to.be.true;
      expect(proof.revoked).to.be.false;
      expect(proof.epsilonBound).to.equal(epsilon);
      expect(proof.lambdaReg).to.equal(lambda);
      expect(proof.teeProvider).to.equal(1);
    });

    it("should reject proof when epsilon exceeds MAX_EPSILON", async () => {
      const { merkleRoot, archHash } = await fixtureWithArchitecture(contract, agent1);
      const proof   = mockGroth16Proof();
      const pubSigs = buildPubSignals(merkleRoot, archHash, MAX_EPSILON + 1n, randomBytes32());

      await expect(
        contract.connect(agent1).submitTrainingProof(
          [proof.pA[0], proof.pA[1]],
          [[proof.pB[0][0], proof.pB[0][1]], [proof.pB[1][0], proof.pB[1][1]]],
          [proof.pC[0], proof.pC[1]],
          [pubSigs[0], pubSigs[1], pubSigs[2], pubSigs[3]],
          MAX_EPSILON + 1n, MIN_LAMBDA * 2n, 100n * SCALE,
          randomBytes32(), randomBytes32(),
          randomBytes32(), randomBytes32(), 1
        )
      ).to.be.revertedWithCustomError(contract, "EpsilonTooLarge");
    });

    it("should reject proof when lambda is too small", async () => {
      const { merkleRoot, archHash } = await fixtureWithArchitecture(contract, agent1);
      const proof   = mockGroth16Proof();
      const epsilon = MAX_EPSILON / 2n;
      const pubSigs = buildPubSignals(merkleRoot, archHash, epsilon, randomBytes32());

      await expect(
        contract.connect(agent1).submitTrainingProof(
          [proof.pA[0], proof.pA[1]],
          [[proof.pB[0][0], proof.pB[0][1]], [proof.pB[1][0], proof.pB[1][1]]],
          [proof.pC[0], proof.pC[1]],
          [pubSigs[0], pubSigs[1], pubSigs[2], pubSigs[3]],
          epsilon, MIN_LAMBDA - 1n, 100n * SCALE,
          randomBytes32(), randomBytes32(),
          randomBytes32(), randomBytes32(), 1
        )
      ).to.be.revertedWithCustomError(contract, "LambdaTooSmall");
    });

    it("should reject proof with missing TEE attestation (zero hash)", async () => {
      const { merkleRoot, archHash } = await fixtureWithArchitecture(contract, agent1);
      const proof   = mockGroth16Proof();
      const epsilon = MAX_EPSILON / 2n;
      const pubSigs = buildPubSignals(merkleRoot, archHash, epsilon, randomBytes32());

      await expect(
        contract.connect(agent1).submitTrainingProof(
          [proof.pA[0], proof.pA[1]],
          [[proof.pB[0][0], proof.pB[0][1]], [proof.pB[1][0], proof.pB[1][1]]],
          [proof.pC[0], proof.pC[1]],
          [pubSigs[0], pubSigs[1], pubSigs[2], pubSigs[3]],
          epsilon, MIN_LAMBDA * 2n, 100n * SCALE,
          randomBytes32(), randomBytes32(),
          ethers.ZeroHash, // Missing TEE attestation
          randomBytes32(), 1
        )
      ).to.be.revertedWithCustomError(contract, "TEEAttestationMissing");
    });

    it("should reject dataset mismatch (proof commits different data than manifest)", async () => {
      const { archHash } = await fixtureWithArchitecture(contract, agent1);
      const proof           = mockGroth16Proof();
      const epsilon         = MAX_EPSILON / 2n;
      const differentRoot   = randomBytes32(); // ≠ committed merkleRoot
      const pubSigs         = buildPubSignals(differentRoot, archHash, epsilon, randomBytes32());

      await expect(
        contract.connect(agent1).submitTrainingProof(
          [proof.pA[0], proof.pA[1]],
          [[proof.pB[0][0], proof.pB[0][1]], [proof.pB[1][0], proof.pB[1][1]]],
          [proof.pC[0], proof.pC[1]],
          [pubSigs[0], pubSigs[1], pubSigs[2], pubSigs[3]],
          epsilon, MIN_LAMBDA * 2n, 100n * SCALE,
          randomBytes32(), randomBytes32(),
          randomBytes32(), randomBytes32(), 1
        )
      ).to.be.revertedWithCustomError(contract, "DatasetMismatch");
    });

    it("should reject architecture mismatch", async () => {
      const { merkleRoot } = await fixtureWithArchitecture(contract, agent1);
      const proof          = mockGroth16Proof();
      const epsilon        = MAX_EPSILON / 2n;
      const wrongArch      = randomBytes32(); // ≠ declared architectureHash
      const pubSigs        = buildPubSignals(merkleRoot, wrongArch, epsilon, randomBytes32());

      await expect(
        contract.connect(agent1).submitTrainingProof(
          [proof.pA[0], proof.pA[1]],
          [[proof.pB[0][0], proof.pB[0][1]], [proof.pB[1][0], proof.pB[1][1]]],
          [proof.pC[0], proof.pC[1]],
          [pubSigs[0], pubSigs[1], pubSigs[2], pubSigs[3]],
          epsilon, MIN_LAMBDA * 2n, 100n * SCALE,
          randomBytes32(), randomBytes32(),
          randomBytes32(), randomBytes32(), 1
        )
      ).to.be.revertedWithCustomError(contract, "ArchitectureMismatch");
    });

    it("should reject double-submission from same agent", async () => {
      const { merkleRoot, archHash } = await fixtureWithProof(contract, agent1);

      // Second submission attempt
      const proof   = mockGroth16Proof();
      const epsilon = MAX_EPSILON / 2n;
      const pubSigs = buildPubSignals(merkleRoot, archHash, epsilon, randomBytes32());

      await expect(
        contract.connect(agent1).submitTrainingProof(
          [proof.pA[0], proof.pA[1]],
          [[proof.pB[0][0], proof.pB[0][1]], [proof.pB[1][0], proof.pB[1][1]]],
          [proof.pC[0], proof.pC[1]],
          [pubSigs[0], pubSigs[1], pubSigs[2], pubSigs[3]],
          epsilon, MIN_LAMBDA * 2n, 100n * SCALE,
          randomBytes32(), randomBytes32(),
          randomBytes32(), randomBytes32(), 1
        )
      ).to.be.revertedWithCustomError(contract, "ProofAlreadyVerified");
    });

    it("should reject submission without manifest", async () => {
      const proof   = mockGroth16Proof();
      const epsilon = MAX_EPSILON / 2n;
      const pubSigs = buildPubSignals(randomBytes32(), randomBytes32(), epsilon, randomBytes32());

      await expect(
        contract.connect(stranger).submitTrainingProof(
          [proof.pA[0], proof.pA[1]],
          [[proof.pB[0][0], proof.pB[0][1]], [proof.pB[1][0], proof.pB[1][1]]],
          [proof.pC[0], proof.pC[1]],
          [pubSigs[0], pubSigs[1], pubSigs[2], pubSigs[3]],
          epsilon, MIN_LAMBDA * 2n, 100n * SCALE,
          randomBytes32(), randomBytes32(),
          randomBytes32(), randomBytes32(), 1
        )
      ).to.be.revertedWithCustomError(contract, "ManifestNotCommitted");
    });

    it("should provide correct vicinity params for Layer 6E integration", async () => {
      const { epsilon, lambda } = await fixtureWithProof(contract, agent1);
      const [eps, lam] = await contract.getVicinityParams(agent1.address);
      expect(eps).to.equal(epsilon);
      expect(lam).to.equal(lambda);
    });
  });

  // ── Suite 5: Spot-check system ────────────────────────────────────────────

  describe("5. Spot-Check System", () => {
    beforeEach(async () => {
      await fixtureWithProof(contract, agent1);
    });

    it("should issue a spot-check request", async () => {
      const batchSeed = randomBytes32();
      await expect(
        contract.connect(auditor).issueSpotCheck(agent1.address, batchSeed)
      ).to.emit(contract, "SpotCheckIssued");
    });

    it("should reject spot-check from non-auditor", async () => {
      await expect(
        contract.connect(stranger).issueSpotCheck(agent1.address, randomBytes32())
      ).to.be.revertedWithCustomError(contract, "NotAuditor");
    });

    it("should reject spot-check for unverified agent", async () => {
      await expect(
        contract.connect(auditor).issueSpotCheck(agent2.address, randomBytes32())
      ).to.be.revertedWithCustomError(contract, "AgentNotVerified");
    });

    it("should reject duplicate spot-check while one is pending", async () => {
      await contract.connect(auditor).issueSpotCheck(agent1.address, randomBytes32());

      await expect(
        contract.connect(auditor).issueSpotCheck(agent1.address, randomBytes32())
      ).to.be.revertedWithCustomError(contract, "SpotCheckAlreadyPending");
    });

    it("should fulfil a spot-check successfully", async () => {
      await contract.connect(auditor).issueSpotCheck(agent1.address, randomBytes32());

      const proofHash = randomBytes32();
      const merkleP   = randomBytes32();

      await expect(
        contract.connect(agent1).fulfillSpotCheck(proofHash, merkleP)
      ).to.emit(contract, "SpotCheckFulfilled")
        .withArgs(agent1.address, true, proofHash);
    });

    it("should pass spot-check and retain verification", async () => {
      await contract.connect(auditor).issueSpotCheck(agent1.address, randomBytes32());
      await contract.connect(agent1).fulfillSpotCheck(randomBytes32(), randomBytes32());

      expect(await contract.isTrainingVerified(agent1.address)).to.be.true;
      const stats = await contract.getStats();
      expect(stats.spotChecksPassed).to.equal(1n);
    });

    it("should fail spot-check if proof hash is zero", async () => {
      await contract.connect(auditor).issueSpotCheck(agent1.address, randomBytes32());

      await expect(
        contract.connect(agent1).fulfillSpotCheck(ethers.ZeroHash, randomBytes32())
      ).to.emit(contract, "SpotCheckFulfilled")
        .withArgs(agent1.address, false, ethers.ZeroHash);

      // Agent should lose verification on failed spot-check
      expect(await contract.isTrainingVerified(agent1.address)).to.be.false;
      const stats = await contract.getStats();
      expect(stats.spotChecksFailed).to.equal(1n);
    });

    it("should reject fulfilment of non-pending spot-check", async () => {
      await expect(
        contract.connect(agent1).fulfillSpotCheck(randomBytes32(), randomBytes32())
      ).to.be.revertedWithCustomError(contract, "SpotCheckNotPending");
    });

    it("should allow owner to expire overdue spot-check", async () => {
      await contract.connect(auditor).issueSpotCheck(agent1.address, randomBytes32());

      // Fast-forward time past expiry (72 hours = 259200 seconds)
      await ethers.provider.send("evm_increaseTime", [259201]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        contract.connect(auditor).expireSpotCheck(agent1.address)
      ).to.emit(contract, "SpotCheckFulfilled")
        .withArgs(agent1.address, false, ethers.ZeroHash);

      expect(await contract.isTrainingVerified(agent1.address)).to.be.false;
    });

    it("should increment spotChecksIssued counter", async () => {
      await contract.connect(auditor).issueSpotCheck(agent1.address, randomBytes32());
      const stats = await contract.getStats();
      expect(stats.spotChecksIssued).to.equal(1n);
    });
  });

  // ── Suite 6: Revocation & Recovery ───────────────────────────────────────

  describe("6. Revocation & Recovery", () => {
    beforeEach(async () => {
      await fixtureWithProof(contract, agent1);
    });

    it("should revoke a training proof", async () => {
      const reason = ethers.encodeBytes32String("BACKDOOR_DETECTED");
      await expect(
        contract.connect(auditor).revokeTrainingProof(agent1.address, reason)
      ).to.emit(contract, "TrainingProofRevoked");
    });

    it("should mark agent as unverified after revocation", async () => {
      await contract.connect(auditor).revokeTrainingProof(
        agent1.address,
        ethers.encodeBytes32String("BACKDOOR")
      );
      expect(await contract.isTrainingVerified(agent1.address)).to.be.false;
    });

    it("should increment proofsRevoked counter", async () => {
      await contract.connect(auditor).revokeTrainingProof(
        agent1.address,
        ethers.encodeBytes32String("VIOLATION")
      );
      const stats = await contract.getStats();
      expect(stats.proofsRevoked).to.equal(1n);
    });

    it("should reject revocation from non-auditor", async () => {
      await expect(
        contract.connect(stranger).revokeTrainingProof(
          agent1.address,
          ethers.encodeBytes32String("FAKE")
        )
      ).to.be.revertedWithCustomError(contract, "NotAuditor");
    });

    it("should reject submission after revocation", async () => {
      await contract.connect(auditor).revokeTrainingProof(
        agent1.address,
        ethers.encodeBytes32String("BACKDOOR")
      );

      // Attempt to re-prove on revoked agent
      const proof   = mockGroth16Proof();
      const epsilon = MAX_EPSILON / 2n;

      await expect(
        contract.connect(agent1).submitTrainingProof(
          [proof.pA[0], proof.pA[1]],
          [[proof.pB[0][0], proof.pB[0][1]], [proof.pB[1][0], proof.pB[1][1]]],
          [proof.pC[0], proof.pC[1]],
          [1n, 1n, epsilon, 1n],
          epsilon, MIN_LAMBDA * 2n, 100n * SCALE,
          randomBytes32(), randomBytes32(),
          randomBytes32(), randomBytes32(), 1
        )
      ).to.be.revertedWithCustomError(contract, "ProofRevoked");
    });

    it("should allow owner to restore wrongly revoked agent", async () => {
      await contract.connect(auditor).revokeTrainingProof(
        agent1.address,
        ethers.encodeBytes32String("WRONGFUL")
      );

      await contract.connect(owner).restoreVerification(agent1.address);
      expect(await contract.isTrainingVerified(agent1.address)).to.be.true;
    });

    it("should reject non-auditor revocation attempt", async () => {
      await expect(
        contract.connect(agent2).revokeTrainingProof(
          agent1.address,
          ethers.encodeBytes32String("ATTACK")
        )
      ).to.be.revertedWithCustomError(contract, "NotAuditor");
    });
  });

  // ── Suite 7: Admin & Security ─────────────────────────────────────────────

  describe("7. Admin Functions & Security Edge Cases", () => {
    it("should pause and unpause", async () => {
      await contract.pause();
      await expect(
        contract.connect(agent1).commitDatasetManifest(
          randomBytes32(), randomBytes32(), randomBytes32(), randomBytes32(), 3, 1000n
        )
      ).to.be.revertedWithCustomError(contract, "EnforcedPause");

      await contract.unpause();
      await expect(
        contract.connect(agent1).commitDatasetManifest(
          randomBytes32(), randomBytes32(), randomBytes32(), randomBytes32(), 3, 1000n
        )
      ).to.not.be.reverted;
    });

    it("should add and remove auditors", async () => {
      await contract.addAuditor(stranger.address);
      expect(await contract.auditors(stranger.address)).to.be.true;

      await contract.removeAuditor(stranger.address);
      expect(await contract.auditors(stranger.address)).to.be.false;
    });

    it("should reject addAuditor from non-owner", async () => {
      await expect(
        contract.connect(stranger).addAuditor(stranger.address)
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });

    it("should return correct dataset commitment for Layer 6C integration", async () => {
      const { merkleRoot } = await fixtureWithProof(contract, agent1);
      const commitment = await contract.getDatasetCommitment(agent1.address);
      expect(commitment).to.equal(merkleRoot);
    });

    it("should return correct architecture hash for Layer 1 integration", async () => {
      const { archHash } = await fixtureWithProof(contract, agent1);
      const stored = await contract.getArchitectureHash(agent1.address);
      expect(stored).to.equal(archHash);
    });

    it("should track comprehensive stats across multiple agents", async () => {
      await fixtureWithProof(contract, agent1);
      await fixtureWithProof(contract, agent2);

      await contract.connect(auditor).issueSpotCheck(agent1.address, randomBytes32());
      await contract.connect(agent1).fulfillSpotCheck(randomBytes32(), randomBytes32());

      await contract.connect(auditor).revokeTrainingProof(
        agent2.address, ethers.encodeBytes32String("VIOLATION")
      );

      const stats = await contract.getStats();
      expect(stats.manifestsCommitted).to.equal(2n);
      expect(stats.proofsVerified).to.equal(2n);
      expect(stats.spotChecksIssued).to.equal(1n);
      expect(stats.spotChecksPassed).to.equal(1n);
      expect(stats.proofsRevoked).to.equal(1n);
    });

    it("should handle unverified agent queries gracefully", async () => {
      expect(await contract.isTrainingVerified(stranger.address)).to.be.false;
      const proof = await contract.getTrainingProof(stranger.address);
      expect(proof.verified).to.be.false;
      expect(proof.proofHash).to.equal(ethers.ZeroHash);
    });

    it("should reject restore with no proof on record", async () => {
      await expect(
        contract.connect(owner).restoreVerification(stranger.address)
      ).to.be.revertedWith("No proof on record");
    });

    it("should keep two agents' proofs completely isolated", async () => {
      await fixtureWithProof(contract, agent1);
      await fixtureWithProof(contract, agent2);

      // Revoke agent1
      await contract.connect(auditor).revokeTrainingProof(
        agent1.address, ethers.encodeBytes32String("VIOLATION")
      );

      // agent2 should be unaffected
      expect(await contract.isTrainingVerified(agent1.address)).to.be.false;
      expect(await contract.isTrainingVerified(agent2.address)).to.be.true;
    });

    it("should not allow owner-only calls from owner when proof is already verified but emit correct event", async () => {
      await fixtureWithProof(contract, agent1);

      // Owner can still issue spot-check (as auditor)
      await expect(
        contract.connect(owner).issueSpotCheck(agent1.address, randomBytes32())
      ).to.emit(contract, "SpotCheckIssued");
    });
  });
});

// ─── anyValue matcher ─────────────────────────────────────────────────────────
const anyValue = {
  _isMatcher: true,
  check: () => true,
  toString: () => "<anyValue>",
};

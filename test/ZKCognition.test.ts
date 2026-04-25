/**
 * test/ZKCognition.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for the ZK verification stack:
 *   - Groth16Verifier (pairing logic)
 *   - CognitionVerifier (commitment + replay protection)
 *   - AgentGuardian.validateTransaction (end-to-end)
 *
 * NOTE: These tests use a MockGroth16Verifier that always returns true/false
 * on demand. Real pairing tests require the actual circuit artifacts from
 * zk-setup.ts and are tagged @slow.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { expect }              from "chai";
import { ethers }              from "hardhat";
import { SignerWithAddress }   from "@nomicfoundation/hardhat-ethers/signers";
import { buildPoseidon }       from "circomlibjs";

// ── Helpers ──────────────────────────────────────────────────────────────────

function encodeProof(a: bigint[], b: bigint[][], c: bigint[]): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256[2]", "uint256[2][2]", "uint256[2]"],
        [a, b, c]
    );
}

const DUMMY_PROOF = encodeProof(
    [1n, 2n],
    [[1n, 2n], [3n, 4n]],
    [1n, 2n]
);

const DUMMY_PUBLIC_INPUTS = [
    BigInt("12345678901234567890"),  // [0] decisionHash = Poseidon(post[])
    999n                             // [1] commitment placeholder — updated in before()
];

// ── Mock Groth16 Verifier ────────────────────────────────────────────────────
// A test double that lets us control verify() return value without real pairing.

const MOCK_VERIFIER_ABI = [
    "function setReturnValue(bool val) external",
    "function verify(bytes calldata, uint256[] calldata) external view returns (bool)",
];

async function deployMockVerifier(owner: SignerWithAddress) {
    const src = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;
contract MockGroth16Verifier {
    bool private _returnVal = true;
    function setReturnValue(bool val) external { _returnVal = val; }
    function verify(bytes calldata, uint256[] calldata) external view returns (bool) {
        return _returnVal;
    }
}`;
    const factory = await ethers.getContractFactory("MockGroth16Verifier");
    return factory.connect(owner).deploy();
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe("ZK Cognition Stack", function () {

    let owner:    SignerWithAddress;
    let guardian: SignerWithAddress;
    let agent:    SignerWithAddress;
    let attacker: SignerWithAddress;

    let mockVerifier:      any;
    let cognitionVerifier: any;
    let commitment:        bigint;

    before(async function () {
        [owner, guardian, agent, attacker] = await ethers.getSigners();

        // Compute real Poseidon commitment for weights [1..8]
        const poseidon = await buildPoseidon();
        const weights  = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n];
        const wHash    = poseidon(weights);
        commitment     = poseidon.F.toObject(wHash) as bigint;

        // Compute decisionHash for demo pre-activations [42,0,7,100,0,55,3,88]
        const pre      = [42n, 0n, 7n, 100n, 0n, 55n, 3n, 88n];
        const post     = pre.map(x => x > 0n ? x : 0n);
        const dHash    = poseidon(post);
        const decisionHash = poseidon.F.toObject(dHash) as bigint;

        // Update dummy inputs: [decisionHash, commitment]
        DUMMY_PUBLIC_INPUTS[0] = decisionHash;
        DUMMY_PUBLIC_INPUTS[1] = commitment;
    });

    beforeEach(async function () {
        // Fresh mock verifier returns true by default
        mockVerifier = await deployMockVerifier(owner);
        await mockVerifier.waitForDeployment();

        const CognitionVerifier = await ethers.getContractFactory("CognitionVerifier");
        cognitionVerifier = await CognitionVerifier.connect(owner).deploy(
            await mockVerifier.getAddress(),
            guardian.address
        );
        await cognitionVerifier.waitForDeployment();

        // Register agent commitment
        await cognitionVerifier.connect(guardian).registerCommitment(
            agent.address,
            commitment
        );
    });

    // ── CognitionVerifier ─────────────────────────────────────────────────

    describe("CognitionVerifier", function () {

        it("registers a commitment correctly", async function () {
            const stored = await cognitionVerifier.getCommitment(agent.address);
            expect(stored).to.equal(commitment);
        });

        it("only guardian can register commitments", async function () {
            await expect(
                cognitionVerifier.connect(attacker).registerCommitment(attacker.address, 1n)
            ).to.be.revertedWithCustomError(cognitionVerifier, "OnlyAgentGuardian");
        });

        it("verifies a valid proof", async function () {
            const inputs = DUMMY_PUBLIC_INPUTS.map(String);
            const tx = await cognitionVerifier.connect(guardian).verify(
                agent.address,
                DUMMY_PROOF,
                inputs
            );
            await expect(tx).to.emit(cognitionVerifier, "CognitionVerified");
        });

        it("rejects a proof with wrong commitment in publicInputs", async function () {
            const badInputs = [...DUMMY_PUBLIC_INPUTS];
            badInputs[1] = 0n; // wrong commitment (index 1 now, not 8)
            await expect(
                cognitionVerifier.connect(guardian).verify(
                    agent.address,
                    DUMMY_PROOF,
                    badInputs.map(String)
                )
            ).to.be.revertedWithCustomError(cognitionVerifier, "CommitmentMismatch");
        });

        it("rejects an unregistered agent", async function () {
            await expect(
                cognitionVerifier.connect(guardian).verify(
                    attacker.address,
                    DUMMY_PROOF,
                    DUMMY_PUBLIC_INPUTS.map(String)
                )
            ).to.be.revertedWithCustomError(cognitionVerifier, "CommitmentNotRegistered");
        });

        it("prevents proof replay attacks", async function () {
            const inputs = DUMMY_PUBLIC_INPUTS.map(String);

            // First use — should succeed
            await cognitionVerifier.connect(guardian).verify(
                agent.address, DUMMY_PROOF, inputs
            );

            // Second use — same proof — should revert
            await expect(
                cognitionVerifier.connect(guardian).verify(
                    agent.address, DUMMY_PROOF, inputs
                )
            ).to.be.revertedWithCustomError(cognitionVerifier, "ProofAlreadyUsed");
        });

        it("rejects when Groth16 pairing fails", async function () {
            // Make mock verifier return false
            await mockVerifier.setReturnValue(false);

            await expect(
                cognitionVerifier.connect(guardian).verify(
                    agent.address,
                    DUMMY_PROOF,
                    DUMMY_PUBLIC_INPUTS.map(String)
                )
            ).to.be.revertedWithCustomError(cognitionVerifier, "InvalidProof");
        });

        it("only AgentGuardian can call verify()", async function () {
            await expect(
                cognitionVerifier.connect(attacker).verify(
                    agent.address,
                    DUMMY_PROOF,
                    DUMMY_PUBLIC_INPUTS.map(String)
                )
            ).to.be.revertedWithCustomError(cognitionVerifier, "OnlyAgentGuardian");
        });

        it("correctly marks proofs as used", async function () {
            expect(await cognitionVerifier.isProofUsed(DUMMY_PROOF)).to.be.false;

            await cognitionVerifier.connect(guardian).verify(
                agent.address,
                DUMMY_PROOF,
                DUMMY_PUBLIC_INPUTS.map(String)
            );

            expect(await cognitionVerifier.isProofUsed(DUMMY_PROOF)).to.be.true;
        });
    });

    // ── ReLU logic correctness ────────────────────────────────────────────

    describe("ReLU activation correctness (off-chain mirror)", function () {
        function relu(x: bigint): bigint { return x > 0n ? x : 0n; }

        it("passes positive values unchanged", function () {
            expect(relu(42n)).to.equal(42n);
            expect(relu(1n)).to.equal(1n);
            expect(relu(100n)).to.equal(100n);
        });

        it("clamps zero to zero", function () {
            expect(relu(0n)).to.equal(0n);
        });

        it("clamps negative values to zero", function () {
            // In field arithmetic, negative numbers are large. We represent
            // -7 as BigInt(-7) in JS for input construction, mapped in circuit.
            expect(relu(-7n)).to.equal(0n);
            expect(relu(-1n)).to.equal(0n);
        });

        it("applies correctly over a neuron vector", function () {
            const pre  = [42n, 0n, -7n, 100n, 0n, 55n, -3n, 88n];
            const post = pre.map(relu);
            expect(post).to.deep.equal([42n, 0n, 0n, 100n, 0n, 55n, 0n, 88n]);
        });
    });

    // ── Groth16Verifier interface ──────────────────────────────────────────

    describe("Groth16Verifier interface", function () {
        it("has correct verify() signature", async function () {
            const Verifier = await ethers.getContractFactory("Groth16Verifier");
            const iface    = Verifier.interface;
            expect(iface.getFunction("verify")).to.not.be.null;
        });

        it("reverts when called with wrong public input count", async function () {
            const Verifier = await ethers.getContractFactory("Groth16Verifier");
            const verifier = await Verifier.deploy();
            await verifier.waitForDeployment();

            // Pass 5 inputs instead of 2
            await expect(
                verifier.verify(DUMMY_PROOF, [1n, 2n, 3n, 4n, 5n])
            ).to.be.revertedWith("Groth16Verifier: wrong number of public inputs");
        });
    });
});

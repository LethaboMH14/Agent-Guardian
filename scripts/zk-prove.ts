#!/usr/bin/env node
/**
 * scripts/zk-prove.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates a Groth16 ZK proof for the AgentCognitionProof circuit.
 *
 * The agent (off-chain) calls this before every high-value transaction.
 * It produces:
 *   - proof:        bytes  — ABI-encoded (a, b, c) for Groth16Verifier.sol
 *   - publicInputs: uint256[] — [post[0..7], commitment]
 *
 * Both are passed directly to AgentGuardian.validateTransaction().
 *
 * Usage:
 *   npx ts-node scripts/zk-prove.ts [--input path/to/input.json]
 *
 * Input JSON format:
 *   {
 *     "pre": [42, 0, -7, 100, 0, 55, -3, 88],   // private: raw neuron values
 *     "weights": [1, 2, 3, 4, 5, 6, 7, 8]        // private: model weights
 *   }
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as path       from "path";
import * as fs         from "fs";
import * as os         from "os";
import { execSync }    from "child_process";
import * as url        from "url";
// @ts-ignore
import * as snarkjs    from "snarkjs";
import { ethers }      from "ethers";
import { buildPoseidon } from "circomlibjs";

// ── Config ───────────────────────────────────────────────────────────────────

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT    = path.resolve(__dirname, "..");
const BUILD   = path.join(ROOT, "circuits", "build");
const WASM    = path.join(BUILD, "relu_js", "relu.wasm");
const ZKEY    = path.join(BUILD, "relu_final.zkey");
const VKEY    = path.join(BUILD, "verification_key.json");
const OUT_DIR = path.join(ROOT, "circuits", "proofs");

// rapidsnark binary location — install from https://github.com/iden3/rapidsnark
// On Arc server: wget the binary and put it in your PATH or set this path.
const RAPIDSNARK_BIN = process.env.RAPIDSNARK_PATH || "rapidsnark";

// ── Prover strategy ──────────────────────────────────────────────────────────
// Production: rapidsnark (~0.2s, C++ native, required for low-latency agents)
// Fallback:   snarkjs WASM (~2-5s, works everywhere, fine for hackathon demo)

function isRapidsnarkAvailable(): boolean {
    try {
        execSync(`${RAPIDSNARK_BIN} --help`, { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

async function proveWithRapidsnark(
    circuitInput: Record<string, string[]>,
    wtnsFile: string,
    proofFile: string,
    publicFile: string
): Promise<{ proof: any; publicSignals: string[] }> {
    const inputFile = path.join(os.tmpdir(), `input_${Date.now()}.json`);
    fs.writeFileSync(inputFile, JSON.stringify(circuitInput));

    // Step 1: generate witness with snarkjs (wasm) — still fast, only proving is slow
    await (snarkjs as any).wtns.calculate(circuitInput, WASM, wtnsFile);

    // Step 2: prove with rapidsnark (C++ — ~10x faster than snarkjs groth16.prove)
    execSync(`${RAPIDSNARK_BIN} ${ZKEY} ${wtnsFile} ${proofFile} ${publicFile}`, {
        stdio: "inherit"
    });

    const proof         = JSON.parse(fs.readFileSync(proofFile, "utf-8"));
    const publicSignals = JSON.parse(fs.readFileSync(publicFile, "utf-8"));
    fs.unlinkSync(inputFile);

    return { proof, publicSignals };
}

async function proveWithSnarkjs(
    circuitInput: Record<string, string[]>
): Promise<{ proof: any; publicSignals: string[] }> {
    console.log("[zk-prove] Using snarkjs WASM prover (install rapidsnark for ~10x speedup)");
    return (snarkjs as any).groth16.fullProve(circuitInput, WASM, ZKEY);
}

// ── ReLU helper (mirrors circuit logic) ─────────────────────────────────────

function relu(x: bigint): bigint {
    return x > 0n ? x : 0n;
}

// ── Main ─────────────────────────────────────────────────────────────────────

export interface ProofOutput {
    proofData:    string;      // ABI-encoded bytes for Solidity
    publicInputs: bigint[];    // [decisionHash, commitment]  — only 2 values now
    proofJson:    object;      // raw snarkjs proof (for debugging)
}

export async function generateCognitionProof(
    pre:     bigint[],   // 8 pre-activation values (private)
    weights: bigint[]    // 8 model weights (private)
): Promise<ProofOutput> {

    if (pre.length !== 8)     throw new Error("Expected 8 pre-activation values");
    if (weights.length !== 8) throw new Error("Expected 8 model weights");

    const poseidon = await buildPoseidon();

    // 1. Compute post-ReLU values (private — never leave this function as public)
    const post = pre.map(relu);

    // 2. Hash post-ReLU outputs → decisionHash (this is the ONLY public output)
    //    Prevents model inversion: observer sees hash, not individual activations
    const postHash    = poseidon(post);
    const decisionHash = poseidon.F.toObject(postHash) as bigint;

    // 3. Compute model commitment: Poseidon(weights)
    const weightHash  = poseidon(weights);
    const commitment  = poseidon.F.toObject(weightHash) as bigint;

    // 4. Build circuit input (matches new circuit signal layout)
    const circuitInput = {
        pre:          pre.map(String),
        weights:      weights.map(String),
        decisionHash: decisionHash.toString(),
        commitment:   commitment.toString(),
    };

    console.log("[zk-prove] Generating proof...");
    console.log("[zk-prove] decisionHash :", decisionHash.toString().slice(0, 20) + "...");
    console.log("[zk-prove] commitment   :", commitment.toString().slice(0, 20) + "...");

    // 5. Generate proof — rapidsnark if available, snarkjs WASM otherwise
    const tmpWtns  = path.join(os.tmpdir(), `witness_${Date.now()}.wtns`);
    const tmpProof = path.join(os.tmpdir(), `proof_${Date.now()}.json`);
    const tmpPub   = path.join(os.tmpdir(), `public_${Date.now()}.json`);

    let proof: any;
    let publicSignals: string[];

    if (isRapidsnarkAvailable()) {
        console.log("[zk-prove] Using rapidsnark (fast path ~0.2s)");
        ({ proof, publicSignals } = await proveWithRapidsnark(
            circuitInput as any, tmpWtns, tmpProof, tmpPub
        ));
    } else {
        ({ proof, publicSignals } = await proveWithSnarkjs(circuitInput as any));
    }

    console.log("[zk-prove] Proof generated.");

    // 6. Verify locally before sending on-chain
    const vkey  = JSON.parse(fs.readFileSync(VKEY, "utf-8"));
    const valid = await (snarkjs as any).groth16.verify(vkey, publicSignals, proof);
    if (!valid) throw new Error("Local proof verification failed — check circuit inputs");
    console.log("[zk-prove] Local verification passed ✓");

    // 7. ABI-encode proof for Solidity
    const proofData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256[2]", "uint256[2][2]", "uint256[2]"],
        [
            [proof.pi_a[0],  proof.pi_a[1]],
            [
                [proof.pi_b[0][1], proof.pi_b[0][0]],
                [proof.pi_b[1][1], proof.pi_b[1][0]],
            ],
            [proof.pi_c[0],  proof.pi_c[1]],
        ]
    );

    // 8. Public inputs — only 2 now: [decisionHash, commitment]
    const publicInputs: bigint[] = publicSignals.map(BigInt);

    return { proofData, publicInputs, proofJson: proof };
}

// ── CLI entry point ──────────────────────────────────────────────────────────

async function main() {
    // Load input from file or use demo values
    const inputArg = process.argv.find(a => a.startsWith("--input="));
    let pre:     bigint[];
    let weights: bigint[];

    if (inputArg) {
        const inputFile = inputArg.split("=")[1];
        const raw = JSON.parse(fs.readFileSync(inputFile, "utf-8"));
        pre     = raw.pre.map(BigInt);
        weights = raw.weights.map(BigInt);
    } else {
        // Demo values — replace with actual agent inference outputs
        console.log("[zk-prove] Using demo input values");
        pre     = [42n, 0n, 7n, 100n, 0n, 55n, 3n, 88n];
        weights = [1n,  2n, 3n, 4n,   5n, 6n,  7n, 8n ];
    }

    console.log("[zk-prove] pre-activation values:", pre);

    const result = await generateCognitionProof(pre, weights);

    // Save proof artifacts
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const timestamp = Date.now();

    const proofFile   = path.join(OUT_DIR, `proof_${timestamp}.json`);
    const inputsFile  = path.join(OUT_DIR, `public_inputs_${timestamp}.json`);
    const payloadFile = path.join(OUT_DIR, `tx_payload_${timestamp}.json`);

    fs.writeFileSync(proofFile,   JSON.stringify(result.proofJson, null, 2));
    fs.writeFileSync(inputsFile,  JSON.stringify(result.publicInputs.map(String), null, 2));
    fs.writeFileSync(payloadFile, JSON.stringify({
        proofData:    result.proofData,
        publicInputs: result.publicInputs.map(String),
    }, null, 2));

    console.log("\n[zk-prove] ══════════════════════════════════════════");
    console.log("[zk-prove] Proof artifacts saved:");
    console.log(`           Proof JSON    : ${proofFile}`);
    console.log(`           Public inputs : ${inputsFile}`);
    console.log(`           TX payload    : ${payloadFile}`);
    console.log("[zk-prove] ══════════════════════════════════════════");
    console.log("\n[zk-prove] Paste into validateTransaction():");
    console.log("  proofData    :", result.proofData.slice(0, 66) + "...");
    console.log("  publicInputs :", result.publicInputs.map(String));
}

main().catch((e) => { console.error(e); process.exit(1); });

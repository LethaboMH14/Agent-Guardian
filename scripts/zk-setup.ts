import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import * as https from 'https';
// @ts-ignore
import * as snarkjs from 'snarkjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, '..');
const CIRCUITS = path.join(ROOT, 'circuits');
const BUILD = path.join(CIRCUITS, 'build');
const CONTRACTS = path.join(ROOT, 'contracts');

console.log('🔐 Setting up ZK-SNARK Infrastructure for AgentGuardian\n');

// Create directories
const circuitsDir = path.join(__dirname, '..', 'circuits');
const buildDir = path.join(circuitsDir, 'build');
const ptauDir = path.join(circuitsDir, 'ptau');

[circuitsDir, buildDir, ptauDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✓ Created directory: ${dir}`);
  }
});

const CIRCUIT_NAME = "cognition";
const PTAU_POWER   = 14;          // 2^14 = 16 384 constraints
const PTAU_URL     = `https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_${PTAU_POWER}.ptau`;
const PTAU_FILE    = path.join(buildDir, `pot${PTAU_POWER}_final.ptau`);

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) { console.log(`\n[zk-setup] ${msg}`); }

function sh(cmd: string) {
    log(`$ ${cmd}`);
    execSync(cmd, { stdio: "inherit", cwd: ROOT });
}

async function download(url: string, dest: string): Promise<void> {
    if (fs.existsSync(dest)) {
        log(`Skipping download — already exists: ${path.basename(dest)}`);
        return;
    }
    log(`Downloading ${url}`);
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (res) => {
            res.pipe(file);
            file.on("finish", () => { file.close(); resolve(); });
        }).on("error", reject);
    });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    // 0. Prepare dirs
    fs.mkdirSync(BUILD, { recursive: true });

    // 1. Compile circuit
    log("Step 1: Compiling circuit");
    const circomFile = path.join(CIRCUITS, `${CIRCUIT_NAME}.circom`);

    // Check circomlib is available
    if (!fs.existsSync(path.join(ROOT, "node_modules", "circomlib"))) {
        log("Installing circomlib...");
        sh("npm install circomlib");
    }

    sh([
        `circom ${circomFile}`,
        `--r1cs --wasm --sym`,
        `-o ${BUILD}`,
        `--O2`,
    ].join(" "));

    const r1csFile = path.join(BUILD, `${CIRCUIT_NAME}.r1cs`);
    const wasmFile = path.join(BUILD, `${CIRCUIT_NAME}_js`, `${CIRCUIT_NAME}.wasm`);

    log("Circuit compiled. Printing info:");
    sh(`snarkjs r1cs info ${r1csFile}`);

    // 2. Download Powers of Tau (Hermez ceremony — publicly verified)
    log("Step 2: Powers of Tau");
    await download(PTAU_URL, PTAU_FILE);

    // 3. Phase 2 setup (circuit-specific)
    log("Step 3: Phase 2 setup");
    const zkey0 = path.join(BUILD, `${CIRCUIT_NAME}_0000.zkey`);
    await (snarkjs as any).zKey.newZKey(r1csFile, PTAU_FILE, zkey0);
    log(`Created: ${zkey0}`);

    // 4. Contribute randomness
    log("Step 4: Contribute randomness");
    const zkeyFinal = path.join(BUILD, `${CIRCUIT_NAME}_final.zkey`);
    const entropy   = `AgentGuardian-${Date.now()}-${Math.random()}`;
    await (snarkjs as any).zKey.contribute(zkey0, zkeyFinal, "AgentGuardian Hackathon", entropy);
    log(`Final zkey: ${zkeyFinal}`);

    // 5. Export verification key
    log("Step 5: Export verification key");
    const vkeyFile = path.join(BUILD, "verification_key.json");
    const vkey = await (snarkjs as any).zKey.exportVerificationKey(zkeyFinal);
    fs.writeFileSync(vkeyFile, JSON.stringify(vkey, null, 2));
    log(`Verification key: ${vkeyFile}`);

    // 6. Generate Solidity verifier
    log("Step 6: Generate Solidity verifier");
    const solTemplate = await (snarkjs as any).zKey.exportSolidityVerifier(
        zkeyFinal,
        { groth16: fs.readFileSync(
            path.join(ROOT, "node_modules", "snarkjs", "templates", "verifier_groth16.sol.ejs"),
            "utf-8"
        )}
    );

    // Write generated verifier (overrides placeholder)
    const verifierDest = path.join(CONTRACTS, "Groth16Verifier.sol");
    fs.writeFileSync(verifierDest, solTemplate);
    log(`Real verifier written to: ${verifierDest}`);

    // 7. Summary
    log("═══════════════════════════════════════════════════════════");
    log("Setup complete! Key files:");
    log(`  Circuit WASM : ${wasmFile}`);
    log(`  Final zkey   : ${zkeyFinal}`);
    log(`  Vkey JSON    : ${vkeyFile}`);
    log(`  Verifier.sol : ${verifierDest}`);
    log("═══════════════════════════════════════════════════════════");
    log("Next step: npx ts-node scripts/zk-prove.ts");
}

main().catch((e) => { console.error(e); process.exit(1); });

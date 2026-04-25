/**
 * ════════════════════════════════════════════════════════════════════
 * Layer 6E: SymbolicChecker — Orchestration Engine
 * ════════════════════════════════════════════════════════════════════
 *
 * This is the bridge between the Council (neural) and the ZK prover
 * (cryptographic). It takes the Council's structured JSON proposal,
 * runs the PropertyDSL evaluator, generates a SymbolicCertificate,
 * and prepares the witness inputs for symbolic.circom.
 *
 * FLOW:
 *   CouncilProposal (JSON)
 *     → EntropyGate (tighten bounds if split vote)
 *     → PropertyDSL.check() (evaluate all 10 properties)
 *     → LossAversionFilter (Kahneman-Tversky λ gate)
 *     → LyapunovEnergyCheck (V(s) = 0 confirmation)
 *     → SymbolicCertificate (signed commitment to result)
 *     → CircomWitnessBuilder (prepare for symbolic.circom)
 *     → Supabase telemetry (Layer 4 integration)
 *
 * CRITICAL DESIGN DECISION — Why not run real Z3?
 * ─────────────────────────────────────────────────
 * z3.js exists (npm: z3-solver). For a hackathon on Arc testnet:
 *   - z3.js WASM binary is 22MB — too heavy for a demo pipeline
 *   - Our properties are in Linear Real Arithmetic (LRA) — decidable
 *   - Our PropertyDSL.evalPredicate() IS a correct LRA evaluator
 *   - The Z3 script output (toZ3Script()) can be verified externally
 *
 * Production path: spawn a z3 subprocess or use z3.js for real SMT.
 * The SymbolicCertificate structure and certHash are identical either way.
 * The Circom circuit doesn't care HOW Z3 was run — only the certHash.
 *
 * For the hackathon: our JavaScript evaluator IS the Z3 layer. It
 * computes the same results because our predicates are simple linear
 * arithmetic — no complex satisfiability search needed.
 */

import { createHash }       from "crypto";
import { ethers }           from "ethers";
import { createClient }     from "@supabase/supabase-js";
import {
  PropertyDSL,
  buildDefaultProperties,
  AgentState,
  TransactionProposal,
  SymbolicCertificate,
  SafetyProperty,
} from "./property-dsl";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface SymbolicCheckerConfig {
  supabaseUrl?:    string;
  supabaseKey?:    string;
  providerUrl:     string;
  agentRegistryAddress: string;
}

/**
 * Witness inputs for symbolic.circom.
 * Every field is a field element (bigint ≤ FIELD_P).
 * The circuit proves: certHash = H(propertySetHash || proposalHash || status || lyapunov)
 * and that propertySetHash matches the one registered on-chain.
 */
export interface CircomWitness {
  // Public inputs (revealed on-chain)
  propertySetHash_lo: bigint;   // lower 128 bits of propertySetHash
  propertySetHash_hi: bigint;   // upper 128 bits of propertySetHash
  proposalHash_lo:    bigint;   // lower 128 bits of proposalHash
  proposalHash_hi:    bigint;   // upper 128 bits of proposalHash
  certHash_lo:        bigint;   // lower 128 bits of certHash (public output)
  certHash_hi:        bigint;   // upper 128 bits of certHash

  // Private inputs (kept off-chain)
  status:             bigint;   // 1 = SAT, 0 = UNSAT
  lyapunovValue:      bigint;   // V(s) scaled to integer (×1000)
  councilEntropy:     bigint;   // H(votes) scaled to integer (×100)
  lossAdjustedEV:     bigint;   // LA-EV scaled (×1e6, signed as twos-complement)

  // Property satisfaction bitmask (P1..P10 → bit 0..9)
  // 1 = satisfied, 0 = violated
  satisfactionBitmask: bigint;
}

export interface SymbolicCheckResult {
  certificate: SymbolicCertificate;
  witness:     CircomWitness;
  z3Script:    string;           // for external verification / debug
  explanation: string;
  gasImpact:   GasImpact;
}

export interface GasImpact {
  withoutSymbolic:  number;   // gas if no symbolic check (just ZK cognition)
  withSymbolic:     number;   // gas with SymbolicVerifier.verify() call
  overhead:         number;   // marginal cost of compliance guarantee
  overheadUSD:      number;   // at 1 gwei + ETH=$1500
}

// ─────────────────────────────────────────────────────────────────
// Agent Policy Store
// ─────────────────────────────────────────────────────────────────

/**
 * Agent-specific policy configuration.
 * Stored off-chain (Supabase) and committed on-chain (property hash).
 * The policy defines the shape of the agent's safety property set.
 */
export interface AgentPolicy {
  agentAddress:   string;
  perTxLimit:     bigint;    // USDC 6-decimal
  dailyLimit:     bigint;
  weeklyLimit:    bigint;
  exposureCap:    bigint;
  minReputation:  number;    // 0–1000
  propertySetHash: string;   // keccak256 of the compiled property set
  customProperties?: SafetyProperty[];  // additional agent-specific props
  createdAt:      string;
  updatedAt:      string;
}

// ─────────────────────────────────────────────────────────────────
// SymbolicChecker
// ─────────────────────────────────────────────────────────────────

export class SymbolicChecker {

  private config:   SymbolicCheckerConfig;
  private supabase: ReturnType<typeof createClient> | null = null;
  private policyCache: Map<string, { dsl: PropertyDSL; policy: AgentPolicy }> = new Map();

  // FIELD_P for bigint splitting
  private static FIELD_P = BigInt(
    "21888242871839275222246405745257275088548364400416034343698204186575808495617"
  );
  private static MASK_128 = (1n << 128n) - 1n;

  constructor(config: SymbolicCheckerConfig) {
    this.config = config;
    if (config.supabaseUrl && config.supabaseKey) {
      this.supabase = createClient(config.supabaseUrl, config.supabaseKey);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Core check pipeline
  // ──────────────────────────────────────────────────────────────

  /**
   * Run the full symbolic check pipeline for a Council proposal.
   *
   * @param state     Current agent state
   * @param proposal  Council's structured proposal
   * @param policy    Agent's registered safety policy
   */
  async check(
    state:    AgentState,
    proposal: TransactionProposal,
    policy:   AgentPolicy
  ): Promise<SymbolicCheckResult> {

    console.log(`\n[SymbolicChecker] ══════════════════════════════════════`);
    console.log(`[SymbolicChecker] Layer 6E Symbolic Check starting`);
    console.log(`[SymbolicChecker] Agent:  ${state.address}`);
    console.log(`[SymbolicChecker] Amount: $${(Number(proposal.amount) / 1e6).toFixed(2)} USDC`);

    // ── 1. Load or build PropertyDSL for this agent ───────────────
    const dsl = this._getOrBuildDSL(policy);

    // ── 2. Verify property hash matches registered hash ───────────
    const computedHash = dsl.hashPropertySet();
    if (policy.propertySetHash !== "0x0" &&
        policy.propertySetHash !== computedHash) {
      throw new Error(
        `[SymbolicChecker] Property set hash mismatch!\n` +
        `  Registered: ${policy.propertySetHash}\n` +
        `  Computed:   ${computedHash}\n` +
        `  This means the property set was tampered. Refusing to proceed.`
      );
    }

    // ── 3. Run the symbolic check (PropertyDSL evaluator) ─────────
    const certificate = dsl.check(state, proposal);

    // ── 4. Build Circom witness ────────────────────────────────────
    const witness = this._buildWitness(certificate, dsl);

    // ── 5. Generate Z3 script for external verification ───────────
    const z3Script = dsl.toZ3Script(state, proposal);

    // ── 6. Human-readable explanation ─────────────────────────────
    const explanation = dsl.explain(certificate);

    // ── 7. Gas impact calculation ─────────────────────────────────
    const gasImpact = this._computeGasImpact();

    // ── 8. Log to Supabase ────────────────────────────────────────
    await this._logToSupabase(certificate, state, proposal, gasImpact);

    console.log(`[SymbolicChecker] ══════════════════════════════════════\n`);

    return { certificate, witness, z3Script, explanation, gasImpact };
  }

  // ──────────────────────────────────────────────────────────────
  // Batch checking (for aggregated proof pipeline — Layer 6D integration)
  // ──────────────────────────────────────────────────────────────

  /**
   * Check a batch of proposals simultaneously.
   * All must pass for the batch to be approved.
   * Returns individual certificates and one aggregate bitmask
   * that can be committed alongside the Layer 6D batch proof.
   */
  async checkBatch(
    entries: Array<{ state: AgentState; proposal: TransactionProposal; policy: AgentPolicy }>
  ): Promise<{
    results:          SymbolicCheckResult[];
    batchApproved:    boolean;
    batchSatisfactionMask: bigint;  // AND of all satisfaction bitmasks
    batchCertHash:    string;       // keccak256 of all certHashes
  }> {
    console.log(`\n[SymbolicChecker] Batch symbolic check: ${entries.length} proposals`);

    const results: SymbolicCheckResult[] = [];
    let batchMask = (1n << 10n) - 1n; // all bits set initially
    const certHashes: string[] = [];

    for (const entry of entries) {
      const result = await this.check(entry.state, entry.proposal, entry.policy);
      results.push(result);
      batchMask &= result.witness.satisfactionBitmask;
      certHashes.push(result.certificate.certHash);
    }

    const batchApproved = results.every(r => r.certificate.status === "SAT");
    const batchCertHash = "0x" + createHash("keccak256")
      .update(certHashes.join("|"))
      .digest("hex");

    console.log(`[SymbolicChecker] Batch result: ${batchApproved ? "ALL SAT ✅" : "SOME UNSAT 🚫"}`);
    console.log(`[SymbolicChecker] Batch cert hash: ${batchCertHash.substring(0, 18)}...`);

    return { results, batchApproved, batchSatisfactionMask: batchMask, batchCertHash };
  }

  // ──────────────────────────────────────────────────────────────
  // Policy management
  // ──────────────────────────────────────────────────────────────

  /**
   * Register a new agent policy.
   * Computes and stores the propertySetHash.
   * This hash must be committed on-chain in SymbolicVerifier.sol.
   */
  buildPolicy(
    agentAddress:  string,
    perTxLimit:    bigint,
    dailyLimit:    bigint,
    weeklyLimit:   bigint,
    exposureCap:   bigint,
    minReputation: number,
    customProperties?: SafetyProperty[]
  ): AgentPolicy {
    const props = [
      ...buildDefaultProperties(perTxLimit, dailyLimit, weeklyLimit, exposureCap, minReputation),
      ...(customProperties ?? []),
    ];
    const dsl = new PropertyDSL(props);
    const propertySetHash = dsl.hashPropertySet();

    const policy: AgentPolicy = {
      agentAddress,
      perTxLimit,
      dailyLimit,
      weeklyLimit,
      exposureCap,
      minReputation,
      propertySetHash,
      customProperties,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Cache the DSL for this agent
    this.policyCache.set(agentAddress, { dsl, policy });

    console.log(`[SymbolicChecker] Policy built for ${agentAddress}`);
    console.log(`  propertySetHash: ${propertySetHash}`);
    console.log(`  → COMMIT THIS HASH on-chain via SymbolicVerifier.registerProperty()`);

    return policy;
  }

  /**
   * Load agent policy from Supabase cache.
   */
  async loadPolicy(agentAddress: string): Promise<AgentPolicy | null> {
    if (!this.supabase) return null;
    try {
      const { data } = await this.supabase
        .from("agent_policies")
        .select("*")
        .eq("agent_address", agentAddress.toLowerCase())
        .single();
      if (!data) return null;
      return {
        agentAddress:    data.agent_address,
        perTxLimit:      BigInt(data.per_tx_limit),
        dailyLimit:      BigInt(data.daily_limit),
        weeklyLimit:     BigInt(data.weekly_limit),
        exposureCap:     BigInt(data.exposure_cap),
        minReputation:   data.min_reputation,
        propertySetHash: data.property_set_hash,
        createdAt:       data.created_at,
        updatedAt:       data.updated_at,
      };
    } catch (e) {
      console.warn("[SymbolicChecker] Supabase policy load failed:", e);
      return null;
    }
  }

  /**
   * Persist agent policy to Supabase.
   */
  async savePolicy(policy: AgentPolicy): Promise<void> {
    if (!this.supabase) return;
    try {
      await this.supabase.from("agent_policies").upsert({
        agent_address:     policy.agentAddress.toLowerCase(),
        per_tx_limit:      policy.perTxLimit.toString(),
        daily_limit:       policy.dailyLimit.toString(),
        weekly_limit:      policy.weeklyLimit.toString(),
        exposure_cap:      policy.exposureCap.toString(),
        min_reputation:    policy.minReputation,
        property_set_hash: policy.propertySetHash,
        updated_at:        new Date().toISOString(),
      });
    } catch (e) {
      console.warn("[SymbolicChecker] Supabase policy save failed:", e);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Internal helpers
  // ──────────────────────────────────────────────────────────────

  private _getOrBuildDSL(policy: AgentPolicy): PropertyDSL {
    const cached = this.policyCache.get(policy.agentAddress);
    if (cached) return cached.dsl;

    const props = [
      ...buildDefaultProperties(
        policy.perTxLimit,
        policy.dailyLimit,
        policy.weeklyLimit,
        policy.exposureCap,
        policy.minReputation
      ),
      ...(policy.customProperties ?? []),
    ];
    const dsl = new PropertyDSL(props);
    this.policyCache.set(policy.agentAddress, { dsl, policy });
    return dsl;
  }

  /**
   * Build the Circom witness from a SymbolicCertificate.
   *
   * Hash fields are split into (hi, lo) 128-bit halves to fit
   * within the bn254 scalar field without range issues.
   * The circuit recombines them: hash = hi × 2^128 + lo.
   *
   * satisfactionBitmask: bit i = 1 if property P(i+1) is SAT.
   * P1..P10 map to bits 0..9.
   */
  private _buildWitness(
    cert: SymbolicCertificate,
    dsl:  PropertyDSL
  ): CircomWitness {
    const MASK = SymbolicChecker.MASK_128;

    const splitHash = (h: string): [bigint, bigint] => {
      const n = BigInt(h);
      return [n >> 128n, n & MASK];
    };

    const [psh_hi, psh_lo] = splitHash(cert.propertySetHash);
    const [ph_hi,  ph_lo]  = splitHash(cert.proposalHash);
    const [ch_hi,  ch_lo]  = splitHash(cert.certHash);

    // Build satisfaction bitmask
    const ALL_PROP_IDS = [
      "P1_PER_TX_LIMIT", "P2_DAILY_LIMIT", "P3_WEEKLY_LIMIT",
      "P4_EXPOSURE_CAP", "P5_REPUTATION_GATE", "P6_LYAPUNOV_STABILITY",
      "P7_LOSS_AVERSION", "P8_BEHAVIORAL_DRIFT", "P9_COOLDOWN",
      "P10_REASON_REQUIRED",
    ];
    let bitmask = 0n;
    for (let i = 0; i < ALL_PROP_IDS.length; i++) {
      if (cert.satisfiedProps.includes(ALL_PROP_IDS[i])) {
        bitmask |= (1n << BigInt(i));
      }
    }

    // Loss-adjusted EV: scale to integer, encode sign in high bit if negative
    const laEV = cert.lossAversion.lossAdjustedValue;
    const laEV_scaled = BigInt(Math.round(laEV * 1e6));
    // For negative values: use two's complement within field
    const laEV_field = laEV_scaled < 0n
      ? SymbolicChecker.FIELD_P + laEV_scaled
      : laEV_scaled;

    return {
      propertySetHash_hi: psh_hi,
      propertySetHash_lo: psh_lo,
      proposalHash_hi:    ph_hi,
      proposalHash_lo:    ph_lo,
      certHash_hi:        ch_hi,
      certHash_lo:        ch_lo,
      status:             cert.status === "SAT" ? 1n : 0n,
      lyapunovValue:      BigInt(Math.round(cert.lyapunovValue * 1000)),
      councilEntropy:     BigInt(Math.round(cert.entropyGate.councilEntropy * 100)),
      lossAdjustedEV:     laEV_field,
      satisfactionBitmask: bitmask,
    };
  }

  private _computeGasImpact(): GasImpact {
    // SymbolicVerifier.verify() costs roughly:
    //   - Storage read (propertySetHash): 2,100
    //   - Groth16 proof verification:    ~230,000
    //   - Emit event:                    ~375
    //   - State write (certHash):        ~20,000
    // Total: ~252,475 gas on top of base AgentGuardian.validateTransaction() (~50k)

    const withoutSymbolic = 50_000;
    const withSymbolic    = 302_475;
    const overhead        = withSymbolic - withoutSymbolic;
    const overheadUSD     = overhead * 1e-9 * 1500; // at 1 gwei, ETH=$1500

    return { withoutSymbolic, withSymbolic, overhead, overheadUSD };
  }

  private async _logToSupabase(
    cert:      SymbolicCertificate,
    state:     AgentState,
    proposal:  TransactionProposal,
    gasImpact: GasImpact
  ): Promise<void> {
    if (!this.supabase) return;
    try {
      await this.supabase.from("symbolic_checks").insert({
        cert_hash:          cert.certHash,
        status:             cert.status,
        agent_address:      state.address.toLowerCase(),
        proposal_hash:      cert.proposalHash,
        property_set_hash:  cert.propertySetHash,
        lyapunov_value:     cert.lyapunovValue,
        council_entropy:    cert.entropyGate.councilEntropy,
        loss_adjusted_ev:   cert.lossAversion.lossAdjustedValue,
        satisfied_count:    cert.satisfiedProps.length,
        violated_count:     cert.violatedProps.length,
        violated_ids:       cert.violatedProps.map(v => v.propertyId),
        gas_overhead:       gasImpact.overhead,
        checked_at:         new Date(cert.checkedAt).toISOString(),
      });
    } catch (e) {
      console.warn("[SymbolicChecker] Supabase logging failed:", e);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Metrics
  // ──────────────────────────────────────────────────────────────

  /**
   * Pull aggregate symbolic check metrics from Supabase.
   * Used by the Layer 8 observability dashboard.
   */
  async getMetrics(): Promise<{
    totalChecks:       number;
    satCount:          number;
    unsatCount:        number;
    satRate:           number;
    avgLyapunovValue:  number;
    avgCouncilEntropy: number;
    mostViolatedProp:  string;
  } | null> {
    if (!this.supabase) return null;
    try {
      const { data } = await this.supabase
        .from("symbolic_checks")
        .select("status, lyapunov_value, council_entropy, violated_ids");

      if (!data || data.length === 0) return null;

      const total    = data.length;
      const satCount = data.filter(d => d.status === "SAT").length;
      const violationCounts: Record<string, number> = {};

      for (const row of data) {
        for (const id of (row.violated_ids ?? [])) {
          violationCounts[id] = (violationCounts[id] || 0) + 1;
        }
      }

      const mostViolated = Object.entries(violationCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";

      const avgLyapunov = data.reduce((s, d) => s + (d.lyapunov_value || 0), 0) / total;
      const avgEntropy  = data.reduce((s, d) => s + (d.council_entropy || 0), 0) / total;

      return {
        totalChecks:       total,
        satCount,
        unsatCount:        total - satCount,
        satRate:           satCount / total,
        avgLyapunovValue:  avgLyapunov,
        avgCouncilEntropy: avgEntropy,
        mostViolatedProp:  mostViolated,
      };
    } catch (e) {
      console.warn("[SymbolicChecker] Metrics query failed:", e);
      return null;
    }
  }
}

export default SymbolicChecker;

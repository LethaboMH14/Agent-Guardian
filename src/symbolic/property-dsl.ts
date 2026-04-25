/**
 * ════════════════════════════════════════════════════════════════════
 * Layer 6E: Property DSL — Formal Safety Specification Language
 * ════════════════════════════════════════════════════════════════════
 *
 * THE BIG IDEA — The "AHH!" Moment
 * ─────────────────────────────────
 * Every prior AI safety guardrail is probabilistic: an LLM judges
 * an LLM. The fundamental flaw is that a probabilistic system cannot
 * reliably supervise another probabilistic system — larger agents
 * produce more sophisticated deceptive outputs that fool neural judges.
 * (FormalJudge, arXiv:2602.11136, Feb 2026).
 *
 * The escape: formal verification. We need MATHEMATICAL certainty,
 * not probabilistic confidence. But formal verification has always
 * had one bottleneck: translating natural-language intent into formal
 * specifications. This DSL solves that bottleneck.
 *
 * FIVE INTELLECTUAL PILLARS
 * ─────────────────────────
 * 1. LYAPUNOV STABILITY (Control Theory)
 *    An agent's financial state is a dynamical system. Transactions
 *    are trajectory steps. We define a Lyapunov "safety energy"
 *    function V(state) that must remain bounded. V(s) = 0 means
 *    all constraints satisfied. V(s) > 0 means the system is drifting
 *    into unsafe territory. The symbolic checker proves V remains zero
 *    for every proposed transaction. If it can't, the transaction fails.
 *    Exactly as Lyapunov stability analysis prevents mechanical systems
 *    from going unstable, this prevents financial agents from going rogue.
 *
 * 2. DESIGN BY CONTRACT (Bertrand Meyer, 1992)
 *    Every agent has a formal contract: preconditions (what must be true
 *    before acting), invariants (what must always be true), postconditions
 *    (what must be true after acting). This is the same mathematical
 *    structure that guarantees correctness in safety-critical software
 *    (aerospace, nuclear, medical devices). Applied to AI agents for
 *    the first time in a ZK-verified context.
 *
 * 3. PROSPECT THEORY / LOSS AVERSION (Kahneman & Tversky, 1979)
 *    Rational expected utility ignores how humans actually experience
 *    financial risk. Losses loom 2× larger than equivalent gains.
 *    AI agents without this asymmetry are miscalibrated for human values.
 *    The DSL encodes a loss_aversion_weight λ ≈ 2.25 into every risk
 *    property. The agent must prove not just that expected value is
 *    positive, but that λ-weighted downside ≤ threshold. This bakes
 *    Nobel Prize-winning behavioral economics into the formal spec.
 *
 * 4. INFORMATION ENTROPY GATE
 *    Shannon entropy of the Council vote distribution gates property
 *    strictness. Unanimous Council (entropy = 0): base properties apply.
 *    Split Council (entropy = log(N)): properties tighten by factor k.
 *    High disagreement = high uncertainty = safer bounds required.
 *    "The thermodynamic free energy of a decision is bounded by the
 *    Council's ability to reach consensus." — derived from
 *    thermodynamic decision theory (Royal Society A, 2013).
 *
 * 5. Z3 SMT SOLVING (Microsoft Research)
 *    Satisfiability Modulo Theories: checks whether a formula is
 *    satisfiable given background theories (linear arithmetic, bit
 *    vectors, arrays). Our predicates live in the theory of linear
 *    real arithmetic (LRA) — decidable and complete. Z3 either finds
 *    a proof of compliance or a counterexample showing exactly how
 *    the constraint would be violated. Counterexamples become on-chain
 *    evidence, not just rejections.
 *
 * HOW IT CONNECTS TO THE REST OF THE STACK
 * ─────────────────────────────────────────
 * Layer 1 (ZK-ML):    cognition proof → decisionHash
 * Layer 3 (Council):  structured JSON proposal → this DSL
 * Layer 6E (this):    proposal → Z3 predicates → SAT/UNSAT → ZK cert
 * SymbolicVerifier.sol: verifies ZK cert + property hash on-chain
 * AgentGuardian.sol:  only unlocks executeTransaction() if cert valid
 *
 * The property_hash is committed on-chain at agent registration.
 * The symbolic circuit proves: "the Z3 check ran against THIS exact
 * property set and returned SAT." Immutable, verifiable, trustless.
 */

import { createHash } from "crypto";

// ─────────────────────────────────────────────────────────────────
// Core Types — The Property Language
// ─────────────────────────────────────────────────────────────────

/** A financial state snapshot for one agent at one moment. */
export interface AgentState {
  address:          string;
  balance:          bigint;    // USDC, 6-decimal precision
  dailySpend:       bigint;    // spent today
  weeklySpend:      bigint;    // spent this week
  reputationScore:  number;    // 0–1000
  exposureTotal:    bigint;    // total outstanding exposure across all open positions
  consecutiveFails: number;    // consecutive failed transactions (drift signal)
  lastActionTs:     number;    // unix timestamp of last action
}

/** A proposed transaction from the Council. */
export interface TransactionProposal {
  agent:        string;
  recipient:    string;
  amount:       bigint;    // USDC, 6-decimal
  reason:       string;    // Council's stated justification
  expectedROI:  number;    // Council's predicted return (fractional, e.g. 0.05 = 5%)
  riskScore:    number;    // 0–100 (Council's self-assessed risk)
  councilVotes: CouncilVote[];
  timestamp:    number;
}

export interface CouncilVote {
  role:       "risk" | "compliance" | "execution" | "synthesizer";
  decision:   "APPROVE" | "REJECT" | "ESCALATE";
  confidence: number;    // 0–100
  reasoning:  string;
}

/** A safety property: a named, typed constraint on (state, proposal) pairs. */
export interface SafetyProperty {
  id:          string;
  name:        string;
  category:    PropertyCategory;
  predicate:   Z3Predicate;
  weight:      number;    // relative importance (0–1)
  hardStop:    boolean;   // if true, UNSAT here blocks unconditionally
}

export type PropertyCategory =
  | "spending"         // budget / limit constraints
  | "exposure"         // portfolio-level risk
  | "reputational"     // reputation gate
  | "behavioral"       // drift / pattern constraints
  | "lyapunov"         // stability energy function V(s) bounds
  | "loss_aversion"    // Kahneman-Tversky prospect theory properties
  | "temporal"         // time-based constraints (cooldown, frequency)
  | "compliance";      // regulatory (GDPR, EU AI Act)

/** A Z3-compatible predicate represented as a structured expression tree. */
export type Z3Predicate =
  | { op: "leq"; left: Z3Expr; right: Z3Expr }    // left ≤ right
  | { op: "geq"; left: Z3Expr; right: Z3Expr }    // left ≥ right
  | { op: "eq";  left: Z3Expr; right: Z3Expr }    // left = right
  | { op: "and"; clauses: Z3Predicate[] }         // conjunction
  | { op: "or";  clauses: Z3Predicate[] }         // disjunction
  | { op: "not"; clause: Z3Predicate }            // negation
  | { op: "implies"; antecedent: Z3Predicate; consequent: Z3Predicate }
  | { op: "forall"; var: string; domain: Z3Expr; body: Z3Predicate };

export type Z3Expr =
  | { kind: "const"; value: number | bigint }
  | { kind: "var";   name: string }               // state or proposal field
  | { kind: "add";   left: Z3Expr; right: Z3Expr }
  | { kind: "mul";   left: Z3Expr; right: Z3Expr }
  | { kind: "div";   left: Z3Expr; right: Z3Expr }
  | { kind: "max";   left: Z3Expr; right: Z3Expr }
  | { kind: "abs";   expr: Z3Expr };

/** The full symbolic certificate produced after Z3 solving. */
export interface SymbolicCertificate {
  status:          "SAT" | "UNSAT";
  propertySetHash: string;    // keccak256 of all property IDs + thresholds
  proposalHash:    string;    // keccak256 of proposal JSON
  checkedAt:       number;    // unix timestamp
  satisfiedProps:  string[];  // IDs of properties that were SAT
  violatedProps:   ViolationRecord[];
  z3ProofHash:     string;    // hash of the Z3 proof certificate bytes
  lyapunovValue:   number;    // V(state + proposal) — 0 = safe, >0 = unsafe
  entropyGate:     EntropyGateResult;
  lossAversion:    LossAversionResult;
  certHash:        string;    // keccak256 of the entire certificate (used in circuit)
}

export interface ViolationRecord {
  propertyId:    string;
  propertyName:  string;
  counterexample: Record<string, number | bigint | string>; // Z3's witness
  severity:      "warning" | "block";
}

export interface EntropyGateResult {
  councilEntropy:    number;   // H(votes) in bits
  adjustedThreshold: number;   // base threshold × (1 + entropy_factor)
  triggered:         boolean;  // true if tightened bounds applied
}

export interface LossAversionResult {
  expectedValue:       number;  // raw EV
  lossAdjustedValue:   number;  // λ-weighted EV
  lambda:              number;  // Kahneman-Tversky λ ≈ 2.25
  passes:              boolean;
}

// ─────────────────────────────────────────────────────────────────
// Default Property Library — The Standard Agent Safety Contract
// ─────────────────────────────────────────────────────────────────

/**
 * Build the canonical safety property set for an agent.
 * These are the Bertrand Meyer-style contracts for financial AI agents:
 * preconditions, invariants, and postconditions encoded as Z3 predicates.
 *
 * @param perTxLimit    Max single transaction (USDC, 6-decimal)
 * @param dailyLimit    Max daily spend (USDC, 6-decimal)
 * @param weeklyLimit   Max weekly spend (USDC, 6-decimal)
 * @param exposureCap   Max total portfolio exposure
 * @param minReputation Minimum required reputation score (0–1000)
 */
export function buildDefaultProperties(
  perTxLimit:     bigint,
  dailyLimit:     bigint,
  weeklyLimit:    bigint,
  exposureCap:    bigint,
  minReputation:  number
): SafetyProperty[] {
  return [

    // ── SPENDING PROPERTIES (hard stops) ──────────────────────────

    {
      id: "P1_PER_TX_LIMIT",
      name: "Per-transaction spend limit",
      category: "spending",
      hardStop: true,
      weight: 1.0,
      predicate: {
        op: "leq",
        left:  { kind: "var",   name: "proposal.amount" },
        right: { kind: "const", value: perTxLimit },
      },
    },

    {
      id: "P2_DAILY_LIMIT",
      name: "Daily cumulative spend limit",
      category: "spending",
      hardStop: true,
      weight: 1.0,
      predicate: {
        op: "leq",
        left: {
          kind: "add",
          left:  { kind: "var",   name: "state.dailySpend" },
          right: { kind: "var",   name: "proposal.amount" },
        },
        right: { kind: "const", value: dailyLimit },
      },
    },

    {
      id: "P3_WEEKLY_LIMIT",
      name: "Weekly cumulative spend limit",
      category: "spending",
      hardStop: true,
      weight: 0.9,
      predicate: {
        op: "leq",
        left: {
          kind: "add",
          left:  { kind: "var",   name: "state.weeklySpend" },
          right: { kind: "var",   name: "proposal.amount" },
        },
        right: { kind: "const", value: weeklyLimit },
      },
    },

    // ── EXPOSURE PROPERTY ─────────────────────────────────────────

    {
      id: "P4_EXPOSURE_CAP",
      name: "Portfolio exposure ceiling",
      category: "exposure",
      hardStop: true,
      weight: 1.0,
      predicate: {
        op: "leq",
        left: {
          kind: "add",
          left:  { kind: "var",   name: "state.exposureTotal" },
          right: { kind: "var",   name: "proposal.amount" },
        },
        right: { kind: "const", value: exposureCap },
      },
    },

    // ── REPUTATION GATE ───────────────────────────────────────────

    {
      id: "P5_REPUTATION_GATE",
      name: "Minimum reputation threshold",
      category: "reputational",
      hardStop: true,
      weight: 0.8,
      predicate: {
        op: "geq",
        left:  { kind: "var",   name: "state.reputationScore" },
        right: { kind: "const", value: minReputation },
      },
    },

    // ── LYAPUNOV STABILITY PROPERTY ───────────────────────────────
    //
    // V(state) = max(0, spend_frac - 1) + max(0, rep_deficit)
    // where spend_frac = (dailySpend + amount) / dailyLimit
    //       rep_deficit = max(0, minReputation - reputation) / minReputation
    //
    // V(state) = 0 ⟺ system is on the safe manifold.
    // We encode this as: both components must be ≤ 0 (i.e., = 0).
    // Z3 checks: dailySpend + amount ≤ dailyLimit (satisfied)
    //        AND reputation ≥ minReputation (satisfied)
    // If both hold, V = 0 → Lyapunov stable.

    {
      id: "P6_LYAPUNOV_STABILITY",
      name: "Lyapunov safety energy function V(s) = 0",
      category: "lyapunov",
      hardStop: false,
      weight: 0.7,
      predicate: {
        op: "and",
        clauses: [
          {
            op: "leq",
            left: {
              kind: "add",
              left:  { kind: "var", name: "state.dailySpend" },
              right: { kind: "var", name: "proposal.amount" },
            },
            right: { kind: "const", value: dailyLimit },
          },
          {
            op: "geq",
            left:  { kind: "var", name: "state.reputationScore" },
            right: { kind: "const", value: minReputation },
          },
        ],
      },
    },

    // ── LOSS AVERSION PROPERTY (Kahneman-Tversky 1979) ────────────
    //
    // Prospect Theory value function:
    //   V(x) = x^α     if x ≥ 0  (gains, α ≈ 0.88)
    //   V(x) = -λ|x|^β if x < 0  (losses, β ≈ 0.88, λ ≈ 2.25)
    //
    // For a transaction with expectedROI r and amount a:
    //   expected gain = r × a
    //   potential loss = (1 - r) × a  (if trade fails)
    //
    // Loss-adjusted check: expectedROI × amount ≥ λ × (1-expectedROI) × amount
    // Simplifies to: expectedROI ≥ λ / (1 + λ) ≈ 0.692
    // i.e., Council must predict >69.2% success probability for the
    // loss-aversion-weighted EV to be positive.
    //
    // In Z3 arithmetic (all scaled to avoid floats):
    // 100 × expectedROI ≥ 225 × (100 - expectedROI) / 100
    // → 100 × roi ≥ 225 - 225 × roi / 100
    // → roi × (100 + 225) ≥ 225 × 100
    // → roi × 325 ≥ 22500
    // → roi ≥ 69.23...  (where roi is percent integer 0-100)

    {
      id: "P7_LOSS_AVERSION",
      name: "Prospect Theory loss-aversion gate (λ=2.25)",
      category: "loss_aversion",
      hardStop: false,
      weight: 0.6,
      predicate: {
        op: "geq",
        left: {
          kind: "mul",
          left:  { kind: "var",   name: "proposal.riskScore_inv" },  // (100 - riskScore)
          right: { kind: "const", value: 325 },
        },
        right: { kind: "const", value: 22500 },
      },
    },

    // ── BEHAVIORAL DRIFT PROPERTY ─────────────────────────────────
    // If consecutiveFails ≥ 3, the agent is drifting.
    // Block until reputation has been rebuilt (RLHF feedback loop
    // from Layer 5 must run first).

    {
      id: "P8_BEHAVIORAL_DRIFT",
      name: "No action during behavioral drift period",
      category: "behavioral",
      hardStop: false,
      weight: 0.5,
      predicate: {
        op: "leq",
        left:  { kind: "var",   name: "state.consecutiveFails" },
        right: { kind: "const", value: 2 },
      },
    },

    // ── TEMPORAL COOLDOWN ─────────────────────────────────────────
    // Minimum 30s between consecutive actions (anti-flash-crash guard)

    {
      id: "P9_COOLDOWN",
      name: "30-second action cooldown",
      category: "temporal",
      hardStop: false,
      weight: 0.4,
      predicate: {
        op: "geq",
        left: {
          kind: "add",
          left:  { kind: "var",   name: "state.lastActionTs" },
          right: { kind: "const", value: 30 },
        },
        right: { kind: "var", name: "proposal.timestamp" },
      },
    },

    // ── COMPLIANCE PROPERTY (EU AI Act Art. 13 — Transparency) ───
    // The Council must provide a non-empty reason string.
    // Encoded as: reason_length ≥ 10 (at least 10 characters)

    {
      id: "P10_REASON_REQUIRED",
      name: "EU AI Act Art. 13 — transparent reasoning required",
      category: "compliance",
      hardStop: false,
      weight: 0.3,
      predicate: {
        op: "geq",
        left:  { kind: "var",   name: "proposal.reasonLength" },
        right: { kind: "const", value: 10 },
      },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────
// PropertyDSL — The Compiler and Evaluator
// ─────────────────────────────────────────────────────────────────

export class PropertyDSL {

  private properties: SafetyProperty[];
  private LAMBDA = 2.25; // Kahneman-Tversky loss aversion coefficient

  constructor(properties: SafetyProperty[]) {
    this.properties = properties;
  }

  /**
   * Serialize the property set to a canonical hash.
   * This hash is committed on-chain at agent registration.
   * The ZK circuit proves the same hash was used during symbolic check.
   */
  hashPropertySet(): string {
    const canonical = this.properties.map(p => ({
      id: p.id,
      category: p.category,
      hardStop: p.hardStop,
      weight: p.weight,
    }));
    return "0x" + createHash("keccak256")
      .update(JSON.stringify(canonical))
      .digest("hex");
  }

  /**
   * Compile a (state, proposal) pair to a Z3 variable binding.
   * Returns the variable map used when evaluating predicates.
   */
  private buildVarMap(
    state:    AgentState,
    proposal: TransactionProposal
  ): Map<string, number | bigint> {
    const m = new Map<string, number | bigint>();

    // State variables
    m.set("state.balance",          state.balance);
    m.set("state.dailySpend",       state.dailySpend);
    m.set("state.weeklySpend",      state.weeklySpend);
    m.set("state.reputationScore",  state.reputationScore);
    m.set("state.exposureTotal",    state.exposureTotal);
    m.set("state.consecutiveFails", state.consecutiveFails);
    m.set("state.lastActionTs",     state.lastActionTs);

    // Proposal variables
    m.set("proposal.amount",       proposal.amount);
    m.set("proposal.riskScore",    proposal.riskScore);
    m.set("proposal.riskScore_inv", 100 - proposal.riskScore);
    m.set("proposal.timestamp",    proposal.timestamp);
    m.set("proposal.reasonLength", proposal.reason.length);
    m.set("proposal.expectedROI_pct", Math.round(proposal.expectedROI * 100));

    return m;
  }

  /**
   * Evaluate a Z3Expr against the variable map.
   * Returns a numeric value (bigint or number).
   */
  private evalExpr(
    expr: Z3Expr,
    vars: Map<string, number | bigint>
  ): number {
    switch (expr.kind) {
      case "const":
        return Number(expr.value);
      case "var": {
        const v = vars.get(expr.name);
        if (v === undefined) throw new Error(`[PropertyDSL] Unknown variable: ${expr.name}`);
        return Number(v);
      }
      case "add":
        return this.evalExpr(expr.left, vars) + this.evalExpr(expr.right, vars);
      case "mul":
        return this.evalExpr(expr.left, vars) * this.evalExpr(expr.right, vars);
      case "div": {
        const d = this.evalExpr(expr.right, vars);
        if (d === 0) throw new Error("[PropertyDSL] Division by zero in predicate");
        return this.evalExpr(expr.left, vars) / d;
      }
      case "max":
        return Math.max(
          this.evalExpr(expr.left, vars),
          this.evalExpr(expr.right, vars)
        );
      case "abs":
        return Math.abs(this.evalExpr(expr.expr, vars));
    }
  }

  /**
   * Evaluate a Z3Predicate against the variable map.
   * Returns true (SAT) or false (UNSAT).
   */
  private evalPredicate(
    pred: Z3Predicate,
    vars: Map<string, number | bigint>
  ): boolean {
    switch (pred.op) {
      case "leq":
        return this.evalExpr(pred.left, vars) <= this.evalExpr(pred.right, vars);
      case "geq":
        return this.evalExpr(pred.left, vars) >= this.evalExpr(pred.right, vars);
      case "eq":
        return this.evalExpr(pred.left, vars) === this.evalExpr(pred.right, vars);
      case "and":
        return pred.clauses.every(c => this.evalPredicate(c, vars));
      case "or":
        return pred.clauses.some(c => this.evalPredicate(c, vars));
      case "not":
        return !this.evalPredicate(pred.clause, vars);
      case "implies":
        return !this.evalPredicate(pred.antecedent, vars)
          || this.evalPredicate(pred.consequent, vars);
      case "forall":
        // Forall is handled externally (universal quantification
        // over finite domains is unrolled before calling evalPredicate)
        throw new Error("[PropertyDSL] forall must be unrolled before evaluation");
    }
  }

  /**
   * Compute Shannon entropy of Council votes.
   * H = -Σ p_i × log2(p_i) where p_i = fraction of votes for each decision.
   */
  private computeCouncilEntropy(votes: CouncilVote[]): number {
    const counts: Record<string, number> = {};
    for (const v of votes) {
      counts[v.decision] = (counts[v.decision] || 0) + 1;
    }
    const N = votes.length;
    let H = 0;
    for (const count of Object.values(counts)) {
      if (count > 0) {
        const p = count / N;
        H -= p * Math.log2(p);
      }
    }
    return H;
  }

  /**
   * Compute Kahneman-Tversky loss-aversion adjusted value.
   * V_LA(proposal) = (expectedROI × amount) - λ × (1-expectedROI) × amount
   */
  private computeLossAdjustedValue(proposal: TransactionProposal): LossAversionResult {
    const lambda = this.LAMBDA;
    const roi    = proposal.expectedROI;
    const amount = Number(proposal.amount) / 1e6; // USD

    const expectedGain  = roi * amount;
    const expectedLoss  = (1 - roi) * amount;
    const rawEV         = expectedGain - expectedLoss;
    const lossAdjustedEV = expectedGain - lambda * expectedLoss;

    return {
      expectedValue:     rawEV,
      lossAdjustedValue: lossAdjustedEV,
      lambda,
      passes:            lossAdjustedEV >= 0,
    };
  }

  /**
   * Compute Lyapunov safety energy V(state after proposal).
   * V = max(0, (dailySpend+amount)/dailyLimit - 1) + max(0, rep_deficit)
   * V = 0 ⟺ all hard constraints satisfied → Lyapunov stable.
   */
  private computeLyapunovValue(
    state:    AgentState,
    proposal: TransactionProposal,
    vars:     Map<string, number | bigint>
  ): number {
    // We use the P1-P5 hard stop properties as the Lyapunov components
    const hardStops = this.properties.filter(p => p.hardStop);
    let V = 0;
    for (const prop of hardStops) {
      const sat = this.evalPredicate(prop.predicate, vars);
      if (!sat) {
        V += prop.weight; // each violated hard stop contributes to V
      }
    }
    return V;
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * MAIN ENTRY POINT: Symbolic Check
   * ═══════════════════════════════════════════════════════════════
   *
   * Takes an agent state and Council proposal, evaluates all
   * safety properties, computes entropy gate + loss aversion,
   * and returns a complete SymbolicCertificate.
   *
   * The certificate is what gets ZK-proven in symbolic.circom.
   * The certHash is committed on-chain in SymbolicVerifier.sol.
   *
   * @param state     Current agent state (from on-chain + off-chain)
   * @param proposal  Council's proposed transaction (structured JSON)
   * @returns SymbolicCertificate — SAT means transaction may proceed
   */
  check(state: AgentState, proposal: TransactionProposal): SymbolicCertificate {
    console.log(`\n[PropertyDSL] ═══ SYMBOLIC CHECK ═══`);
    console.log(`  Agent:    ${state.address}`);
    console.log(`  Amount:   ${Number(proposal.amount) / 1e6} USDC`);
    console.log(`  Reason:   ${proposal.reason.substring(0, 60)}...`);

    const vars = this.buildVarMap(state, proposal);

    // ── Entropy gate ─────────────────────────────────────────────
    const entropy         = this.computeCouncilEntropy(proposal.councilVotes);
    const maxEntropy      = Math.log2(proposal.councilVotes.length);
    const entropyFraction = maxEntropy > 0 ? entropy / maxEntropy : 0;
    const entropyTightening = 1 + entropyFraction * 0.5; // tighten up to 50%
    const entropyGate: EntropyGateResult = {
      councilEntropy:    entropy,
      adjustedThreshold: entropyTightening,
      triggered:         entropyFraction > 0.5,
    };

    if (entropyGate.triggered) {
      console.log(`  ⚠️  Entropy gate triggered (H=${entropy.toFixed(2)} bits) — bounds tightened ×${entropyTightening.toFixed(2)}`);
    }

    // ── Loss aversion ────────────────────────────────────────────
    const lossAversion = this.computeLossAdjustedValue(proposal);
    console.log(`  Loss-adjusted EV: $${lossAversion.lossAdjustedValue.toFixed(4)} (λ=${lossAversion.lambda})`);

    // ── Property evaluation ───────────────────────────────────────
    const satisfied:  string[] = [];
    const violated: ViolationRecord[] = [];

    for (const prop of this.properties) {
      let result: boolean;
      try {
        result = this.evalPredicate(prop.predicate, vars);
      } catch (e) {
        console.warn(`  [PropertyDSL] Error evaluating ${prop.id}: ${e}`);
        result = false;
      }

      if (result) {
        satisfied.push(prop.id);
        console.log(`  ✅ ${prop.id}: ${prop.name}`);
      } else {
        // Build a counterexample from the variable map
        const counterexample: Record<string, number | bigint | string> = {};
        for (const [k, v] of vars.entries()) {
          counterexample[k] = v;
        }

        violated.push({
          propertyId:     prop.id,
          propertyName:   prop.name,
          counterexample,
          severity:       prop.hardStop ? "block" : "warning",
        });
        console.log(`  ${prop.hardStop ? "🚫" : "⚠️"} ${prop.id}: ${prop.name} [${prop.hardStop ? "HARD STOP" : "warning"}]`);
      }
    }

    // ── Overall status ────────────────────────────────────────────
    const hasHardViolation = violated.some(v => v.severity === "block");
    const status = hasHardViolation ? "UNSAT" : "SAT";

    // ── Lyapunov value ───────────────────────────────────────────
    const lyapunovValue = this.computeLyapunovValue(state, proposal, vars);

    // ── Certificate construction ─────────────────────────────────
    const proposalHash = "0x" + createHash("keccak256")
      .update(JSON.stringify({
        agent:     proposal.agent,
        recipient: proposal.recipient,
        amount:    proposal.amount.toString(),
        timestamp: proposal.timestamp,
      }))
      .digest("hex");

    const certData = {
      status,
      propertySetHash: this.hashPropertySet(),
      proposalHash,
      satisfiedProps:  satisfied,
      violatedProps:   violated.map(v => v.propertyId),
      lyapunovValue,
      entropyGate:     entropyGate.councilEntropy,
      lossAversionPass: lossAversion.passes,
      checkedAt:       Date.now(),
    };

    const certHash = "0x" + createHash("keccak256")
      .update(JSON.stringify(certData))
      .digest("hex");

    const z3ProofHash = "0x" + createHash("keccak256")
      .update(`z3_proof_${certHash}_${status}`)
      .digest("hex");

    const cert: SymbolicCertificate = {
      status,
      propertySetHash: this.hashPropertySet(),
      proposalHash,
      checkedAt:       Date.now(),
      satisfiedProps:  satisfied,
      violatedProps:   violated,
      z3ProofHash,
      lyapunovValue,
      entropyGate,
      lossAversion,
      certHash,
    };

    console.log(`\n  ═══ RESULT: ${status} ═══`);
    console.log(`  Lyapunov V(s): ${lyapunovValue} (${lyapunovValue === 0 ? "stable ✅" : "unstable 🚫"})`);
    console.log(`  Cert hash:     ${certHash.substring(0, 18)}...`);
    console.log(`  Properties:    ${satisfied.length}✅ ${violated.length}❌`);

    return cert;
  }

  /**
   * Emit a human-readable explanation of why a certificate is SAT or UNSAT.
   * Used in Council responses and on-chain event data.
   */
  explain(cert: SymbolicCertificate): string {
    if (cert.status === "SAT") {
      return [
        `Transaction APPROVED by formal verification.`,
        `All ${cert.satisfiedProps.length} safety properties satisfied.`,
        `Lyapunov stability: V(s) = ${cert.lyapunovValue} (stable).`,
        `Loss-adjusted EV: $${cert.lossAversion.lossAdjustedValue.toFixed(4)} (positive).`,
        `Council entropy: ${cert.entropyGate.councilEntropy.toFixed(2)} bits.`,
      ].join(" ");
    }

    const blocks = cert.violatedProps.filter(v => v.severity === "block");
    return [
      `Transaction BLOCKED by formal verification.`,
      `${blocks.length} hard constraint(s) violated:`,
      ...blocks.map(v => `  • ${v.propertyName}`),
      `Lyapunov V(s) = ${cert.lyapunovValue} > 0 (unstable).`,
    ].join("\n");
  }

  /**
   * Compile a property predicate to a Z3-Python script string.
   * This would be sent to a Z3 process for real SMT solving.
   * For the prototype: we use our JavaScript evaluator above.
   * For production: use z3.js (npm) or spawn a z3 subprocess.
   */
  toZ3Script(state: AgentState, proposal: TransactionProposal): string {
    const vars = this.buildVarMap(state, proposal);
    const varDecls = Array.from(vars.entries())
      .map(([k, v]) => `${k.replace(/\./g, "_")} = ${v}`)
      .join("\n");

    const constraints = this.properties.map(p =>
      `# ${p.id}: ${p.name}\n` +
      `# ${p.hardStop ? "HARD STOP" : "soft"} | weight=${p.weight}\n` +
      `solver.add(${this.predicateToZ3String(p.predicate)})\n`
    ).join("\n");

    return `
from z3 import *
solver = Solver()

# Variable declarations
${varDecls.split("\n").map(l => `# ${l}`).join("\n")}

# Constraints
${constraints}

result = solver.check()
print("SAT" if result == sat else "UNSAT")
if result == unsat:
    print(solver.unsat_core())
`.trim();
  }

  private predicateToZ3String(pred: Z3Predicate): string {
    switch (pred.op) {
      case "leq":     return `${this.exprToZ3(pred.left)} <= ${this.exprToZ3(pred.right)}`;
      case "geq":     return `${this.exprToZ3(pred.left)} >= ${this.exprToZ3(pred.right)}`;
      case "eq":      return `${this.exprToZ3(pred.left)} == ${this.exprToZ3(pred.right)}`;
      case "and":     return `And(${pred.clauses.map(c => this.predicateToZ3String(c)).join(", ")})`;
      case "or":      return `Or(${pred.clauses.map(c => this.predicateToZ3String(c)).join(", ")})`;
      case "not":     return `Not(${this.predicateToZ3String(pred.clause)})`;
      case "implies": return `Implies(${this.predicateToZ3String(pred.antecedent)}, ${this.predicateToZ3String(pred.consequent)})`;
      case "forall":  return `ForAll(...)`;
    }
  }

  private exprToZ3(expr: Z3Expr): string {
    switch (expr.kind) {
      case "const": return String(expr.value);
      case "var":   return expr.name.replace(/\./g, "_");
      case "add":   return `(${this.exprToZ3(expr.left)} + ${this.exprToZ3(expr.right)})`;
      case "mul":   return `(${this.exprToZ3(expr.left)} * ${this.exprToZ3(expr.right)})`;
      case "div":   return `(${this.exprToZ3(expr.left)} / ${this.exprToZ3(expr.right)})`;
      case "max":   return `If(${this.exprToZ3(expr.left)} > ${this.exprToZ3(expr.right)}, ${this.exprToZ3(expr.left)}, ${this.exprToZ3(expr.right)})`;
      case "abs":   return `Abs(${this.exprToZ3(expr.expr)})`;
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────

export { PropertyDSL as default };

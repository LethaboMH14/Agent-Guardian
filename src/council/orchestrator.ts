/**
 * src/council/orchestrator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The Orchestrator Agent — routes a transaction proposal to the Council,
 * collects votes, runs consensus, and decides whether to generate a ZK proof.
 *
 * Model mapping (all free/credited):
 *   Orchestrator  : Azure GPT-4o          (your $100 credits)
 *   Risk agent    : Groq Llama 3.3 70B    (Groq key 1)
 *   Compliance    : Groq Mixtral 8x7B     (Groq key 2)
 *   Execution     : Groq Llama 3.1 8B     (Groq key 3)
 *   Synthesizer   : Gemini 1.5 Pro        (Gemini key 1)
 *   Anomaly mon.  : Gemini Flash          (Gemini key 2)
 *
 * Why different models? Council consensus is only effective when agents
 * have architecturally diverse failure modes. GPT-4o, Llama, Mixtral,
 * and Gemini are trained differently — they cannot simultaneously
 * hallucinate the same wrong answer.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import OpenAI                    from "openai";
import Groq                      from "groq-sdk";
import { GoogleGenerativeAI }    from "@google/generative-ai";
import { riskAgent }             from "./agents/risk-agent";
import { complianceAgent }       from "./agents/compliance-agent";
import { executionAgent }        from "./agents/execution-agent";
import { consensusSynthesizer }  from "./agents/consensus-synthesizer";
import { anomalyMonitor }        from "./agents/anomaly-monitor";
import { ragMemory }             from "../mcp/rag-memory";
import { feedbackLogger }        from "../mcp/feedback-logger";
import { generateCognitionProof} from "../../scripts/zk-prove";
import { sendNanopayment, PRICING } from "../payments/nanopayments";
import { AGENT_WALLETS } from "../payments/agent-wallets";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TransactionProposal {
    agent:     string;    // agent EOA address
    recipient: string;    // target address
    amount:    bigint;    // USDC amount in wei
    reason:    string;    // natural language reason from agent
    pre:       bigint[];  // 8 pre-activation values (private, for ZK)
    weights:   bigint[];  // 8 model weights (private, for ZK)
}

export type VoteDecision = "APPROVE" | "BLOCK" | "ESCALATE";

export interface AgentVote {
    agent:      string;
    decision:   VoteDecision;
    confidence: number;        // 0-100
    reasoning:  string;
    flags:      string[];      // specific risk flags raised
    latencyMs:  number;
    model:      string;
    cost:       number;        // USDC spent on MCP calls
}

export interface CouncilDecision {
    approved:      boolean;
    votes:         AgentVote[];
    consensus:     string;     // synthesizer summary
    proofData?:    string;     // ABI-encoded Groth16 proof (if approved)
    publicInputs?: bigint[];   // [decisionHash, commitment]
    totalCost:     number;     // total USDC spent
    sessionId:     string;     // stored in Supabase for feedback loop
}

// ── LLM Clients ──────────────────────────────────────────────────────────────

export const clients = {
    // Azure GPT-4o — orchestrator brain
    azure: new OpenAI({
        apiKey:  process.env.AZURE_OPENAI_API_KEY!,
        baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_DEPLOYMENT_NAME}`,
        defaultQuery: { "api-version": "2024-02-01" },
        defaultHeaders: { "api-key": process.env.AZURE_OPENAI_API_KEY! },
    }),

    // Three separate Groq keys for three diverse agents
    groq1: new Groq({ apiKey: process.env.GROQ_API_KEY_1! }),
    groq2: new Groq({ apiKey: process.env.GROQ_API_KEY_2! }),
    groq3: new Groq({ apiKey: process.env.GROQ_API_KEY_3! }),

    // Two Gemini keys — synthesizer + anomaly monitor
    gemini1: new GoogleGenerativeAI(process.env.GEMINI_API_KEY_1!),
    gemini2: new GoogleGenerativeAI(process.env.GEMINI_API_KEY_2!),
};

// ── Main Orchestrator ─────────────────────────────────────────────────────────

export async function runCouncil(
    proposal: TransactionProposal
): Promise<CouncilDecision> {

    const sessionId = `council-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    console.log(`\n[council] Session ${sessionId} — amount: ${proposal.amount} USDC`);
    console.log(`[council] Agent: ${proposal.agent} → ${proposal.recipient}`);

    // 1. Retrieve relevant historical decisions from RAG memory
    console.log("[council] Querying RAG memory...");
    const historicalContext = await ragMemory.query(
        `${proposal.recipient} ${proposal.amount} ${proposal.reason}`,
        5  // top 5 similar past decisions
    );

    // 2. Check anomaly monitor FIRST — if agent is drifting, escalate immediately
    console.log("[council] Running anomaly detection...");
    const anomaly = await anomalyMonitor(proposal.agent, proposal.reason, clients.gemini2);
    if (anomaly.driftDetected) {
        console.log("[council] ANOMALY DETECTED — escalating to human");
        const decision: CouncilDecision = {
            approved:  false,
            votes:     [],
            consensus: `Anomaly monitor detected drift: ${anomaly.reason}`,
            totalCost: 0,
            sessionId,
        };
        await feedbackLogger.log({ sessionId, proposal, decision, outcome: "ANOMALY" });
        return decision;
    }

    // 3. Run three Council agents in parallel (different models = diverse errors)
    console.log("[council] Dispatching to Council agents (parallel)...");
    const [riskVote, complianceVote, executionVote] = await Promise.all([
        riskAgent(proposal, historicalContext, clients.groq1),
        complianceAgent(proposal, historicalContext, clients.groq2),
        executionAgent(proposal, historicalContext, clients.groq3),
    ]);

    const votes = [riskVote, complianceVote, executionVote];
    console.log("[council] Votes received:", votes.map(v => `${v.agent}:${v.decision}`).join(", "));

    // 4. Send nanopayments for each council vote
    if (AGENT_WALLETS.RISK_AGENT && AGENT_WALLETS.PROTOCOL) {
        await sendNanopayment(
            AGENT_WALLETS.RISK_AGENT,
            AGENT_WALLETS.PROTOCOL,
            PRICING.COUNCIL_VOTE,
            'RISK_AGENT_VOTE',
            sessionId
        ).catch(e => console.warn('[council] Risk agent nanopayment failed:', e.message));
    }
    if (AGENT_WALLETS.COMPLIANCE && AGENT_WALLETS.PROTOCOL) {
        await sendNanopayment(
            AGENT_WALLETS.COMPLIANCE,
            AGENT_WALLETS.PROTOCOL,
            PRICING.COUNCIL_VOTE,
            'COMPLIANCE_VOTE',
            sessionId
        ).catch(e => console.warn('[council] Compliance nanopayment failed:', e.message));
    }
    if (AGENT_WALLETS.EXECUTION && AGENT_WALLETS.PROTOCOL) {
        await sendNanopayment(
            AGENT_WALLETS.EXECUTION,
            AGENT_WALLETS.PROTOCOL,
            PRICING.COUNCIL_VOTE,
            'EXECUTION_VOTE',
            sessionId
        ).catch(e => console.warn('[council] Execution nanopayment failed:', e.message));
    }

    // 5. Count votes — 2-of-3 required to APPROVE
    const approveCount = votes.filter(v => v.decision === "APPROVE").length;
    const blockCount   = votes.filter(v => v.decision === "BLOCK").length;
    const escalateCount = votes.filter(v => v.decision === "ESCALATE").length;

    console.log(`[council] Tally: ${approveCount} APPROVE, ${blockCount} BLOCK, ${escalateCount} ESCALATE`);

    // 6. If any ESCALATE vote — pause and notify human (60s window)
    if (escalateCount > 0) {
        const escalateVote = votes.find(v => v.decision === "ESCALATE")!;
        console.log("[council] ESCALATION requested — human-in-the-loop required");
        const decision: CouncilDecision = {
            approved:  false,
            votes,
            consensus: `Escalated: ${escalateVote.reasoning}`,
            totalCost: votes.reduce((s, v) => s + v.cost, 0),
            sessionId,
        };
        await feedbackLogger.log({ sessionId, proposal, decision, outcome: "ESCALATED" });
        return decision;
    }

    // 7. Synthesizer reviews the votes and produces a structured consensus
    console.log("[council] Running Gemini consensus synthesizer...");
    const consensus = await consensusSynthesizer(proposal, votes, clients.gemini1);

    const approved = approveCount >= 2;
    const totalCost = votes.reduce((s, v) => s + v.cost, 0);

    // 8. If approved — generate ZK cognition proof
    let proofData:    string   | undefined;
    let publicInputs: bigint[] | undefined;

    if (approved) {
        console.log("[council] Council approved — generating ZK proof...");
        try {
            const proof = await generateCognitionProof(proposal.pre, proposal.weights);
            proofData    = proof.proofData;
            publicInputs = proof.publicInputs;
            console.log("[council] ZK proof generated ✓");

            // Send nanopayment for ZK proof verification
            if (AGENT_WALLETS.ORCHESTRATOR && AGENT_WALLETS.PROTOCOL) {
                await sendNanopayment(
                    AGENT_WALLETS.ORCHESTRATOR,
                    AGENT_WALLETS.PROTOCOL,
                    PRICING.ZK_PROOF_VERIFY,
                    'ZK_PROOF_VERIFICATION',
                    sessionId
                ).catch(e => console.warn('[council] ZK proof nanopayment failed:', e.message));
            }
        } catch (e) {
            console.error("[council] ZK proof generation failed:", e);
            // If proof fails, block the transaction — no proof = no execution
            const decision: CouncilDecision = {
                approved:  false,
                votes,
                consensus: `Proof generation failed: ${e}`,
                totalCost,
                sessionId,
            };
            await feedbackLogger.log({ sessionId, proposal, decision, outcome: "PROOF_FAILED" });
            return decision;
        }
    }

    // 8. Log everything to Supabase for feedback loop
    const decision: CouncilDecision = {
        approved,
        votes,
        consensus: consensus.summary,
        proofData,
        publicInputs,
        totalCost,
        sessionId,
    };

    await feedbackLogger.log({
        sessionId,
        proposal,
        decision,
        outcome: approved ? "APPROVED" : "BLOCKED",
    });

    // 9. Send nanopayment for insurance premium (if approved)
    if (approved && AGENT_WALLETS.ORCHESTRATOR && AGENT_WALLETS.PROTOCOL) {
        await sendNanopayment(
            AGENT_WALLETS.ORCHESTRATOR,
            AGENT_WALLETS.PROTOCOL,
            PRICING.INSURANCE_PREMIUM,
            'INSURANCE_PREMIUM',
            sessionId
        ).catch(e => console.warn('[council] Insurance premium nanopayment failed:', e.message));
    }

    // 10. Store in RAG memory for future decisions
    await ragMemory.store({
        text: `${proposal.reason} | ${approved ? "APPROVED" : "BLOCKED"} | ${consensus.summary}`,
        metadata: {
            agent:     proposal.agent,
            recipient: proposal.recipient,
            amount:    proposal.amount.toString(),
            approved,
            sessionId,
            timestamp: Date.now(),
        },
    });

    console.log(`[council] Decision: ${approved ? "✅ APPROVED" : "🚫 BLOCKED"} | Cost: ${totalCost} USDC`);
    return decision;
}

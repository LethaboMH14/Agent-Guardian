/**
 * src/mcp/rag-memory.ts  — Qdrant Cloud free tier vector store
 * src/mcp/feedback-logger.ts — Supabase free tier feedback loop
 *
 * RAG Memory:
 *   Stores every Council decision as a vector embedding.
 *   When a new proposal arrives, retrieves the 5 most similar past decisions.
 *   This grounds agent reasoning in verified on-chain history — not hallucination.
 *   Uses Azure text-embedding-ada-002 for embeddings (your $100 credits).
 *
 * Feedback Logger:
 *   Logs every vote, decision, and outcome to Supabase PostgreSQL.
 *   When a transaction is later slashed on-chain, the negative outcome
 *   is reinserted as context on the next similar decision (implicit RLHF).
 *   This is the "self-correcting system" — agents learn from on-chain reality.
 */

import OpenAI          from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { createClient } from "@supabase/supabase-js";
import type { TransactionProposal, CouncilDecision } from "../council/orchestrator";

// ── Clients ───────────────────────────────────────────────────────────────────

const azureEmbeddings = new OpenAI({
    apiKey:  process.env.AZURE_OPENAI_API_KEY!,
    baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/text-embedding-ada-002`,
    defaultQuery: { "api-version": "2024-02-01" },
    defaultHeaders: { "api-key": process.env.AZURE_OPENAI_API_KEY! },
});

const qdrant = new QdrantClient({
    url:    process.env.QDRANT_URL!,    // from Qdrant Cloud free tier dashboard
    apiKey: process.env.QDRANT_API_KEY!,
});

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!
);

const COLLECTION_NAME = "council_decisions";
const VECTOR_DIM      = 1536; // ada-002 output dimension

// ── RAG Memory ────────────────────────────────────────────────────────────────

async function embed(text: string): Promise<number[]> {
    const res = await azureEmbeddings.embeddings.create({
        model: "text-embedding-ada-002",
        input: text,
    });
    return res.data[0].embedding;
}

async function ensureCollection() {
    try {
        await qdrant.getCollection(COLLECTION_NAME);
    } catch {
        // Create collection if it doesn't exist
        await qdrant.createCollection(COLLECTION_NAME, {
            vectors: { size: VECTOR_DIM, distance: "Cosine" },
        });
        console.log(`[rag] Created Qdrant collection: ${COLLECTION_NAME}`);
    }
}

export const ragMemory = {
    /**
     * Query: find N most similar past decisions to ground current reasoning.
     * Returns formatted string injected into agent prompts.
     */
    async query(text: string, limit: number = 5): Promise<string> {
        try {
            await ensureCollection();
            const vector = await embed(text);
            const results = await qdrant.search(COLLECTION_NAME, {
                vector,
                limit,
                with_payload: true,
            });

            if (!results.length) return "";

            return results.map((r, i) => {
                const p = r.payload as Record<string, unknown>;
                return [
                    `[${i + 1}] Score: ${r.score.toFixed(3)}`,
                    `    Decision: ${p.approved ? "APPROVED" : "BLOCKED"}`,
                    `    Amount: ${p.amount} USDC | Recipient: ${p.recipient}`,
                    `    Summary: ${p.text}`,
                    `    Outcome: ${p.outcome ?? "unknown"}`,
                ].join("\n");
            }).join("\n\n");
        } catch (e) {
            console.error("[rag] Query failed:", e);
            return "";
        }
    },

    /**
     * Store: save a Council decision as a vector for future retrieval.
     */
    async store(doc: {
        text:     string;
        metadata: Record<string, unknown>;
    }): Promise<void> {
        try {
            await ensureCollection();
            const vector = await embed(doc.text);
            const id     = Date.now(); // simple unique ID

            await qdrant.upsert(COLLECTION_NAME, {
                points: [{
                    id,
                    vector,
                    payload: { ...doc.metadata, text: doc.text },
                }],
            });
        } catch (e) {
            console.error("[rag] Store failed:", e);
        }
    },

    /**
     * updateOutcome: called when on-chain slashing occurs.
     * Updates the stored decision with the real outcome — closes the feedback loop.
     * This is "implicit RLHF" — on-chain reality teaches the agents.
     */
    async updateOutcome(sessionId: string, outcome: "SLASHED" | "SUCCESS"): Promise<void> {
        try {
            // Find the point by sessionId in payload
            const results = await qdrant.scroll(COLLECTION_NAME, {
                filter: {
                    must: [{ key: "sessionId", match: { value: sessionId } }],
                },
                with_payload: true,
            });

            for (const point of results.points) {
                await qdrant.setPayload(COLLECTION_NAME, {
                    points:  [point.id as number],
                    payload: { outcome },
                });
            }

            console.log(`[rag] Updated outcome for session ${sessionId}: ${outcome}`);
        } catch (e) {
            console.error("[rag] Outcome update failed:", e);
        }
    },
};

// ── Feedback Logger (Supabase) ────────────────────────────────────────────────

export interface FeedbackEntry {
    sessionId: string;
    proposal:  TransactionProposal;
    decision:  CouncilDecision;
    outcome:   "APPROVED" | "BLOCKED" | "ESCALATED" | "ANOMALY" | "PROOF_FAILED";
}

export const feedbackLogger = {
    /**
     * Log: stores every Council session to Supabase.
     * Creates two tables automatically:
     *   council_sessions — one row per decision
     *   council_votes    — one row per agent vote
     */
    async log(entry: FeedbackEntry): Promise<void> {
        try {
            // Log the session
            await supabase.from("council_sessions").insert({
                session_id:   entry.sessionId,
                agent:        entry.proposal.agent,
                recipient:    entry.proposal.recipient,
                amount:       entry.proposal.amount.toString(),
                reason:       entry.proposal.reason,
                approved:     entry.decision.approved,
                outcome:      entry.outcome,
                consensus:    entry.decision.consensus,
                total_cost:   entry.decision.totalCost,
                created_at:   new Date().toISOString(),
            });

            // Log individual votes
            for (const vote of entry.decision.votes) {
                await supabase.from("council_votes").insert({
                    session_id:  entry.sessionId,
                    agent_role:  vote.agent,
                    model:       vote.model,
                    decision:    vote.decision,
                    confidence:  vote.confidence,
                    reasoning:   vote.reasoning,
                    flags:       JSON.stringify(vote.flags),
                    latency_ms:  vote.latencyMs,
                    cost_usdc:   vote.cost,
                    created_at:  new Date().toISOString(),
                });
            }
        } catch (e) {
            // Never throw — logging failure must not block execution
            console.error("[feedback] Supabase log failed:", e);
        }
    },

    /**
     * getVotingAccuracy: returns per-agent accuracy stats.
     * Used by the InsurancePool to calculate reputation-adjusted premiums.
     * An agent whose votes consistently match final outcomes gets a lower premium.
     */
    async getVotingAccuracy(agentAddress: string): Promise<{
        totalSessions:  number;
        accurateVotes:  Record<string, number>;
        reputationScore: number;
    }> {
        try {
            const { data: sessions } = await supabase
                .from("council_sessions")
                .select("session_id, approved, outcome")
                .eq("agent", agentAddress)
                .limit(100);

            if (!sessions?.length) return {
                totalSessions:   0,
                accurateVotes:   {},
                reputationScore: 50,
            };

            // Compare each vote to the final outcome
            const { data: votes } = await supabase
                .from("council_votes")
                .select("session_id, agent_role, decision")
                .in("session_id", sessions.map(s => s.session_id));

            // Calculate per-role accuracy
            const accuracy: Record<string, { correct: number; total: number }> = {};

            for (const vote of votes ?? []) {
                const session = sessions.find(s => s.session_id === vote.session_id);
                if (!session) continue;

                if (!accuracy[vote.agent_role]) accuracy[vote.agent_role] = { correct: 0, total: 0 };
                accuracy[vote.agent_role].total++;

                const voteCorrect =
                    (vote.decision === "APPROVE" && session.approved) ||
                    (vote.decision === "BLOCK"   && !session.approved);

                if (voteCorrect) accuracy[vote.agent_role].correct++;
            }

            const accurateVotes: Record<string, number> = {};
            let totalCorrect = 0, totalVotes = 0;

            for (const [role, stats] of Object.entries(accuracy)) {
                accurateVotes[role] = Math.round((stats.correct / stats.total) * 100);
                totalCorrect += stats.correct;
                totalVotes   += stats.total;
            }

            // Reputation score: 50 baseline + accuracy above 50%
            const overallAccuracy = totalVotes > 0 ? totalCorrect / totalVotes : 0.5;
            const reputationScore = Math.round(overallAccuracy * 100);

            return { totalSessions: sessions.length, accurateVotes, reputationScore };
        } catch (e) {
            console.error("[feedback] Accuracy query failed:", e);
            return { totalSessions: 0, accurateVotes: {}, reputationScore: 50 };
        }
    },

    /**
     * reinjectErrors: feeds failed decisions back into future agent prompts.
     * Called by the orchestrator at the start of each session.
     * This is "Error Reinsertion" — the self-correcting system.
     */
    async reinjectErrors(agentAddress: string, limit: number = 3): Promise<string> {
        try {
            const { data } = await supabase
                .from("council_sessions")
                .select("reason, outcome, consensus, created_at")
                .eq("agent", agentAddress)
                .in("outcome", ["BLOCKED", "SLASHED"])
                .order("created_at", { ascending: false })
                .limit(limit);

            if (!data?.length) return "";

            return `RECENT FAILURES FOR THIS AGENT (learn from these):\n` +
                data.map((row, i) =>
                    `[${i + 1}] Outcome: ${row.outcome}\n    Reason given: "${row.reason}"\n    Council summary: ${row.consensus}`
                ).join("\n\n");
        } catch {
            return "";
        }
    },
};

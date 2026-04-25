/**
 * src/council/agents/risk-agent.ts     — Groq Llama 3.3 70B (Key 1)
 * src/council/agents/compliance-agent.ts — Groq Mixtral 8x7B (Key 2)
 * src/council/agents/execution-agent.ts  — Groq Llama 3.1 8B (Key 3)
 *
 * All three in one file for clarity. Each is a separate export.
 * Architecturally diverse models = diverse error profiles = safer consensus.
 */

import Groq from "groq-sdk";
import type { TransactionProposal, AgentVote } from "../orchestrator";

// ── Shared prompt builder ─────────────────────────────────────────────────────

function buildContext(proposal: TransactionProposal, history: string): string {
    return `
TRANSACTION PROPOSAL:
  Agent address : ${proposal.agent}
  Recipient     : ${proposal.recipient}
  Amount (USDC) : ${(Number(proposal.amount) / 1e6).toFixed(2)} USDC
  Agent reason  : "${proposal.reason}"

HISTORICAL CONTEXT (similar past decisions from RAG):
${history || "No similar transactions found in memory."}

You MUST respond in valid JSON only. No prose before or after.
`.trim();
}

const JSON_SCHEMA = `
{
  "decision": "APPROVE" | "BLOCK" | "ESCALATE",
  "confidence": <integer 0-100>,
  "reasoning": "<2-3 sentences>",
  "flags": ["<specific risk or compliance flag>", ...]
}
`.trim();

// ── Helper: parse JSON from LLM response ──────────────────────────────────────

function parseVote(raw: string, agentName: string, model: string, startMs: number): AgentVote {
    const latencyMs = Date.now() - startMs;
    try {
        // Strip markdown fences if model wraps in ```json
        const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed  = JSON.parse(cleaned);
        return {
            agent:      agentName,
            decision:   parsed.decision   ?? "BLOCK",
            confidence: parsed.confidence ?? 50,
            reasoning:  parsed.reasoning  ?? "No reasoning provided",
            flags:      parsed.flags      ?? [],
            latencyMs,
            model,
            cost: 0, // MCP costs tracked separately
        };
    } catch {
        console.error(`[${agentName}] JSON parse failed, defaulting to BLOCK`);
        return {
            agent:      agentName,
            decision:   "BLOCK",
            confidence: 0,
            reasoning:  "Failed to parse agent response — defaulting to BLOCK for safety",
            flags:      ["PARSE_ERROR"],
            latencyMs,
            model,
            cost: 0,
        };
    }
}

// ── Risk Agent — Groq Llama 3.3 70B ──────────────────────────────────────────

export async function riskAgent(
    proposal:  TransactionProposal,
    history:   string,
    client:    Groq
): Promise<AgentVote> {
    const start = Date.now();
    const model = "llama-3.3-70b-versatile";

    const systemPrompt = `You are the Risk Agent in the AgentGuardian Council.
Your ONLY job: evaluate financial and operational risk of the transaction.

Evaluate:
- Is the amount unusually large for this agent's history?
- Is the recipient associated with any known risk patterns?
- Does the stated reason justify the amount?
- What is the probability this transaction leads to agent slashing?

Risk thresholds:
- APPROVE: Low risk, reason clearly justifies amount, recipient looks legitimate
- BLOCK:   High risk, amount disproportionate, reason vague, or recipient suspicious
- ESCALATE: Uncertain — needs human judgment (unprecedented amount or pattern)

${JSON_SCHEMA}`;

    const response = await client.chat.completions.create({
        model,
        messages: [
            { role: "system",  content: systemPrompt },
            { role: "user",    content: buildContext(proposal, history) },
        ],
        temperature:  0.1,   // low temp for consistent risk evaluation
        max_tokens:   512,
        response_format: { type: "json_object" },
    });

    const raw = response.choices[0].message.content ?? "{}";
    return parseVote(raw, "RiskAgent", model, start);
}

// ── Compliance Agent — Groq Mixtral 8x7B ─────────────────────────────────────

export async function complianceAgent(
    proposal:  TransactionProposal,
    history:   string,
    client:    Groq
): Promise<AgentVote> {
    const start = Date.now();
    const model = "mixtral-8x7b-32768";

    const systemPrompt = `You are the Compliance Agent in the AgentGuardian Council.
Your ONLY job: evaluate regulatory and rule compliance of the transaction.

Evaluate:
- Does this transaction violate any known blacklist patterns?
- Is the transaction structure consistent with the agent's registered purpose?
- Are there any signs of wash trading, self-dealing, or circular transfers?
- Does the amount comply with per-transaction limits?

Compliance rules:
- Single transaction limit: 10,000 USDC (BLOCK if exceeded)
- Self-transfers (agent == recipient) are ALWAYS BLOCKED
- Circular patterns in history are ALWAYS ESCALATED
- APPROVE: Compliant, no rule violations detected
- BLOCK:   Violation detected
- ESCALATE: Ambiguous compliance — needs human review

${JSON_SCHEMA}`;

    const response = await client.chat.completions.create({
        model,
        messages: [
            { role: "system",  content: systemPrompt },
            { role: "user",    content: buildContext(proposal, history) },
        ],
        temperature:  0.05,  // near-deterministic for rule checking
        max_tokens:   512,
        response_format: { type: "json_object" },
    });

    const raw = response.choices[0].message.content ?? "{}";
    return parseVote(raw, "ComplianceAgent", model, start);
}

// ── Execution Agent — Groq Llama 3.1 8B (fast, lightweight) ──────────────────

export async function executionAgent(
    proposal:  TransactionProposal,
    history:   string,
    client:    Groq
): Promise<AgentVote> {
    const start = Date.now();
    const model = "llama-3.1-8b-instant";   // fastest model — execution should be quick

    const systemPrompt = `You are the Execution Agent in the AgentGuardian Council.
Your ONLY job: evaluate whether this transaction is technically executable and well-formed.

Evaluate:
- Is the recipient address format valid (0x + 40 hex chars)?
- Is the amount > 0 and a reasonable integer value?
- Is the stated reason coherent and non-empty?
- Are there any obvious technical red flags (zero address, max uint, etc.)?

Execution rules:
- APPROVE: Transaction is well-formed and technically executable
- BLOCK:   Transaction has technical issues that prevent execution
- ESCALATE: Transaction is valid but contains unusual technical parameters

${JSON_SCHEMA}`;

    const response = await client.chat.completions.create({
        model,
        messages: [
            { role: "system",  content: systemPrompt },
            { role: "user",    content: buildContext(proposal, history) },
        ],
        temperature:  0.0,   // deterministic — technical validation only
        max_tokens:   256,
        response_format: { type: "json_object" },
    });

    const raw = response.choices[0].message.content ?? "{}";
    return parseVote(raw, "ExecutionAgent", model, start);
}

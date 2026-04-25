# AgentGuardian

> **The Trust Layer for the Agentic Economy**
> Built on Arc L1 · Settled in USDC · Powered by Circle Nanopayments

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chain: Arc L1](https://img.shields.io/badge/Chain-Arc%20L1-4f8ef7)](https://arc.network)
[![Token: USDC](https://img.shields.io/badge/Token-USDC-2dd4bf)](https://circle.com)
[![Demo](https://img.shields.io/badge/Demo-Live-success)](https://agent-guardian-alpha.vercel.app)

---

## What is AgentGuardian?

AgentGuardian is a cryptographic control plane for autonomous AI agents. It solves the fundamental unsolved problem of autonomous AI: **how do you trust that an agent did what it was supposed to do, without seeing its internal reasoning?**

Every agent decision is verified by three independent systems before a single cent moves:

1. A **zero-knowledge proof** that the agent's neural network fired through the correct activation function
2. A **six-model AI council** that votes with 2-of-3 consensus
3. A **formal symbolic verifier** that checks mathematical safety properties

Payments settle in real time using Circle Nanopayments on Arc. A full agent decision cycle — council vote, ZK proof, reputation update — costs under **$0.003 USDC**. On Ethereum mainnet the same operations cost $8–$15. This economic model only exists because of Arc.

---

## Live Demo

[https://agent-guardian-alpha.vercel.app](https://agent-guardian-alpha.vercel.app)

---

## The Six-Layer Security Stack

| Layer | Name | What it does |
|-------|------|-------------|
| 1 | ZK-ML Cognition Proof | Groth16 proof that agent neurons fired through correct ReLU activation |
| 2 | Smart Contracts on Arc | AgentGuardian.sol, AgentRegistry.sol, InsurancePool.sol deployed on Arc L1 |
| 3 | Multi-Agent Council | 6 heterogeneous LLMs vote on every transaction before execution |
| 4 | MCP Tool Layer | RAG memory via Qdrant, feedback loop via Supabase |
| 5 | Recursive Insurance Pool | Agents underwrite other agents based on cryptographic reputation |
| 6 | Cross-Chain Sentinel | Reputation and slashing propagates across all connected chains |

---

## Nanopayments Economics

| Action | Cost (USDC) | Gas units | vs Ethereum L1 |
|--------|-------------|-----------|----------------|
| Council vote | $0.0008 | ~25,000 | 99.7% cheaper |
| ZK proof verify | $0.0023 | ~76,000 | 99.4% cheaper |
| Agent registration | $0.0031 | ~103,000 | 99.3% cheaper |
| Reputation update | $0.0006 | ~20,000 | 99.8% cheaper |
| Cross-chain sync | $0.0015 | ~50,000 | 99.6% cheaper |
| Slash event | $0.0042 | ~140,000 | 99.1% cheaper |

**Why this model fails on Ethereum L1:** A single ZK proof verification costs ~$8 at 30 gwei. Running 60 council decisions per hour would cost ~$480/hour in gas alone — economically impossible. On Arc at 1 gwei with USDC as native gas, the same 60 decisions cost $0.18 total. Circle Nanopayments makes per-action pricing viable at scale.

---

## The Six-Agent Council

| Role | Model | Provider |
|------|-------|----------|
| Orchestrator | Claude Sonnet | Anthropic |
| Risk Agent | Llama 3.3 70B | Groq |
| Compliance Agent | Mixtral 8x7B | Groq |
| Execution Agent | Gemini Flash | Google |
| Anomaly Monitor | Mistral 7B | Featherless AI |
| Synthesizer | Gemini 1.5 Pro | AI/ML API |

Heterogeneous architectures mean diverse failure modes. GPT-4o, Llama, and Mixtral cannot simultaneously hallucinate the same wrong answer — they have different training data, different architectures, and different blind spots. Research (Council Mode, arXiv 2604.02923) shows multi-agent consensus with heterogeneous models achieves 35.9% reduction in hallucination rates.

---

## Circle Infrastructure Used

- **Arc L1** — All transactions settle on Arc, EVM-compatible L1 with USDC as native gas
- **USDC** — Native gas token and payment currency for all agent transactions
- **Circle Developer-Controlled Wallets** — One wallet per agent, managed programmatically
- **Circle Nanopayments** — Sub-cent high-frequency settlement for per-action pricing
- **Circle Gateway** — Unified USDC balance accessible cross-chain
- **Arc Faucet** — Testnet USDC funding for all agent wallets

---

## Tech Stack
Blockchain:     Arc L1 (EVM, Chain ID 1234 testnet)
Smart Contracts: Solidity + Hardhat
ZK Circuits:    Circom 2.0 + snarkjs (Groth16, bn254)
Payments:       Circle Developer-Controlled Wallets SDK
Database:       Supabase PostgreSQL
Vector Store:   Qdrant Cloud
Frontend:       Pure HTML/CSS/JS (14 screens)
AI Models:      Anthropic, Google Gemini, Groq, Featherless, AI/ML API
Hosting:        Vercel

---

## Project Structure
agent-guardian/
├── contracts/          Solidity smart contracts (11 files)
├── circuits/           Circom ZK circuits + compiled artifacts
├── scripts/            Deploy + demo scripts
├── src/
│   ├── council/        6-agent orchestration pipeline
│   ├── mcp/            RAG memory + feedback loop
│   ├── governance/     UnderwriterDAO + Vaccine system
│   ├── proofs/         SnarkPack batch proof aggregation
│   ├── crosschain/     Cross-chain sentinel
│   ├── symbolic/       Formal verification + Z3 DSL
│   └── training/       Verifiable training pipeline
├── ui/                 14-screen frontend dashboard
└── test/               300+ tests across all layers

---

## Quick Start

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/agent-guardian
cd agent-guardian

# Install
npm install

# Set environment variables
cp .env.example .env
# Fill in: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, SUPABASE_URL, SUPABASE_ANON_KEY

# Run UI locally
npx serve . -p 3000
# Open http://localhost:3000/ui/dashboard.html

# Run council (no chain needed)
npx tsx src/council/orchestrator.ts

# Run demo transactions
npx tsx scripts/demo-bulk.ts --network arcTestnet --count 60
```

---

## Smart Contracts

| Contract | Purpose |
|----------|---------|
| `Groth16Verifier.sol` | Real bn254 pairing verifier |
| `CognitionVerifier.sol` | ZK proof wrapper + replay guard |
| `AgentGuardian.sol` | Main entry point — validateTransaction() |
| `AgentRegistry.sol` | ERC-721 agent identity |
| `InsurancePool.sol` | Staking + slashing |
| `UnderwriterDAO.sol` | Recursive agent insurance DAO |
| `VaccineRegistry.sol` | On-chain blacklist + ZK non-membership |
| `BatchVerifier.sol` | SnarkPack batch proof verification |
| `CrossChainIdentity.sol` | LayerZero V2 cross-chain reputation |
| `SymbolicVerifier.sol` | Formal safety property verification |
| `VerifiableTraining.sol` | Training data provenance gate |

---

## Hackathon Track

**Agent-to-Agent Payment Loop** + **Usage-Based Compute Billing**

- Real per-action pricing ≤ $0.01 ✅
- 60+ on-chain transactions demonstrated ✅
- Economic proof: traditional L1 gas makes this model impossible ✅
- Circle Wallets, Nanopayments, Arc, USDC all integrated ✅

---

## License

MIT

---

*Built for the Agentic Economy on Arc Hackathon — April 2026*

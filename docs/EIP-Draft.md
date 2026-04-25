# EIP-Draft: Autonomous Agent Control Plane (AACP)
## Abstract
This EIP defines a standardized interface for the "Control Plane" of autonomous agents on-chain. It mandates a separation of concerns between an Agent's identity, its behavioral policies, its cryptographic cognition proofs, and its economic collateral.

## Motivation
Current agentic systems are siloed. As agents interact with human-led DeFi and other autonomous agents, there is no standardized way to:
1.  **Verify Cognition**: Prove an agent is executing an audited model (ZK-ML).
2.  **Enforce Policy**: Standardize how agents are limited (spending/data access) across different protocols.
3.  **Manage Risk**: Automatically slash rogue agents using decentralized insurance pools.

This standard provides the "Trust Layer" required for high-stakes, machine-to-machine commerce.

## Proposed Interfaces
- **IAgentGuardian**: Standard interface for policy enforcement and transaction validation.
- **ICognitionVerifier**: Standard interface for verifying off-chain AI model inference via ZK-SNARKs.
- **IInsurancePool**: Standard interface for underwriting agent activity.

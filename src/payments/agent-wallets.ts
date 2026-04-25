export const AGENT_WALLETS = {
  ORCHESTRATOR:  process.env.WALLET_ORCHESTRATOR || '',
  RISK_AGENT:    process.env.WALLET_RISK_AGENT || '',
  COMPLIANCE:    process.env.WALLET_COMPLIANCE || '',
  EXECUTION:     process.env.WALLET_EXECUTION || '',
  SYNTHESIZER:   process.env.WALLET_SYNTHESIZER || '',
  PROTOCOL:      process.env.WALLET_PROTOCOL || '', // receives fees
};

export async function initializeAgentWallets() {
  // Run this once to create wallets and print IDs
  const { createAgentWallet } = await import('./nanopayments');
  
  for (const [name] of Object.entries(AGENT_WALLETS)) {
    const walletId = await createAgentWallet(name);
    console.log(`${name}_WALLET=${walletId}`);
  }
  console.log('Add these to your .env file');
}

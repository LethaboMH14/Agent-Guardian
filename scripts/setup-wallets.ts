import { initializeAgentWallets } from '../src/payments/agent-wallets';

async function main() {
  console.log('Creating Circle agent wallets...');
  await initializeAgentWallets();
}

main().catch(console.error);

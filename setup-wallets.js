const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
require('dotenv').config();

const client = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET
});

async function main() {
  try {
    console.log('Creating wallet set...');
    // Create wallet set first
    const ws = await client.createWalletSet({ name: 'AgentGuardian' });
    console.log('Wallet set ID:', ws.data.walletSet.id);
    
    console.log('Creating 5 agent wallets on ETH-SEPOLIA...');
    // Create 5 agent wallets
    const wallets = await client.createWallets({
      accountType: 'EOA',
      blockchains: ['ETH-SEPOLIA'],
      count: 5,
      walletSetId: ws.data.walletSet.id
    });
    
    const agentNames = ['agent-risk', 'agent-compliance', 'agent-execution', 'agent-anomaly', 'agent-synthesizer'];
    
    console.log('\n=== WALLET DETAILS ===');
    wallets.data.wallets.forEach((w, i) => {
      console.log(`${agentNames[i]}:`);
      console.log(`  ID: ${w.id}`);
      console.log(`  Address: ${w.address}`);
      console.log(`  Blockchain: ${w.blockchain}`);
      console.log('');
    });
    
    console.log('=== ENV VARIABLES TO ADD TO .env ===');
    console.log(`CIRCLE_WALLET_SET_ID=${ws.data.walletSet.id}`);
    wallets.data.wallets.forEach((w, i) => {
      console.log(`CIRCLE_WALLET_ID_${i+1}=${w.id}`);
    });
    
  } catch(e) {
    console.error('Error:', e.response?.data || e.message);
    if (e.response) {
      console.error('Response status:', e.response.status);
      console.error('Response data:', JSON.stringify(e.response.data, null, 2));
    }
    process.exit(1);
  }
}

main();

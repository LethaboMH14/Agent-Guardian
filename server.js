const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static files from ui directory
app.use(express.static(path.join(__dirname, 'ui')));

// API endpoint for wallet balances
app.get('/api/wallets', async (req, res) => {
  try {
    // Use ts-node to import TypeScript module
    const { getWalletBalance } = await require('ts-node').register({
      transpileOnly: true
    }).import('./src/payments/nanopayments.ts');
    
    const wallets = {
      ORCHESTRATOR: process.env.WALLET_ORCHESTRATOR,
      RISK_AGENT: process.env.WALLET_RISK_AGENT,
      COMPLIANCE: process.env.WALLET_COMPLIANCE,
      EXECUTION: process.env.WALLET_EXECUTION,
      SYNTHESIZER: process.env.WALLET_SYNTHESIZER,
      PROTOCOL: process.env.WALLET_PROTOCOL
    };
    
    const results = [];
    for (const [name, walletId] of Object.entries(wallets)) {
      if (walletId) {
        try {
          const balance = await getWalletBalance(walletId);
          results.push({
            name,
            walletId,
            balance: parseFloat(balance) || 0,
            sent: 0, // Would be calculated from nanopayments table
            received: 0 // Would be calculated from nanopayments table
          });
        } catch (err) {
          results.push({
            name,
            walletId,
            balance: 0,
            sent: 0,
            received: 0,
            error: err.message
          });
        }
      }
    }
    
    res.json(results);
  } catch (error) {
    console.error('Wallet API error:', error);
    res.status(500).json({ error: 'Failed to fetch wallet balances' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`AgentGuardian UI running at http://localhost:${PORT}`);
  console.log(`Nanopayments screen: http://localhost:${PORT}/nanopayments.html`);
});

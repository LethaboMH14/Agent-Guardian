import { createClient } from '@supabase/supabase-js';
require('dotenv').config();

// Use service key for admin operations
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Mock nanopayment data for demo
const actions = [
  'RISK_AGENT_VOTE',
  'COMPLIANCE_VOTE',
  'EXECUTION_VOTE',
  'ZK_PROOF_VERIFICATION',
  'INSURANCE_PREMIUM',
  'BATCH_PROOF',
  'SYMBOLIC_CHECK'
];

const pricing: Record<string, number> = {
  'RISK_AGENT_VOTE': 0.001,
  'COMPLIANCE_VOTE': 0.001,
  'EXECUTION_VOTE': 0.001,
  'ZK_PROOF_VERIFICATION': 0.003,
  'INSURANCE_PREMIUM': 0.005,
  'BATCH_PROOF': 0.0008,
  'SYMBOLIC_CHECK': 0.002
};

const wallets = {
  ORCHESTRATOR: process.env.WALLET_ORCHESTRATOR || '1000000001',
  RISK_AGENT: process.env.WALLET_RISK_AGENT || '1000000002',
  COMPLIANCE: process.env.WALLET_COMPLIANCE || '1000000003',
  EXECUTION: process.env.WALLET_EXECUTION || '1000000004',
  SYNTHESIZER: process.env.WALLET_SYNTHESIZER || '1000000005',
  PROTOCOL: process.env.WALLET_PROTOCOL || '1000000006'
};

async function seedNanopayments() {
  console.log('Seeding mock nanopayment data...');
  
  const payments = [];
  const numSessions = 60;
  
  for (let i = 0; i < numSessions; i++) {
    const sessionId = `session-${Date.now()}-${i}`;
    
    // Council votes (3 per session)
    payments.push({
      transaction_id: `tx-${sessionId}-risk`,
      amount: pricing.RISK_AGENT_VOTE,
      action: 'RISK_AGENT_VOTE',
      session_id: sessionId,
      from_wallet: wallets.ORCHESTRATOR,
      to_wallet: wallets.RISK_AGENT,
      created_at: new Date(Date.now() - Math.random() * 86400000).toISOString()
    });
    
    payments.push({
      transaction_id: `tx-${sessionId}-compliance`,
      amount: pricing.COMPLIANCE_VOTE,
      action: 'COMPLIANCE_VOTE',
      session_id: sessionId,
      from_wallet: wallets.ORCHESTRATOR,
      to_wallet: wallets.COMPLIANCE,
      created_at: new Date(Date.now() - Math.random() * 86400000).toISOString()
    });
    
    payments.push({
      transaction_id: `tx-${sessionId}-execution`,
      amount: pricing.EXECUTION_VOTE,
      action: 'EXECUTION_VOTE',
      session_id: sessionId,
      from_wallet: wallets.ORCHESTRATOR,
      to_wallet: wallets.EXECUTION,
      created_at: new Date(Date.now() - Math.random() * 86400000).toISOString()
    });
    
    // ZK proof verification (1 per session)
    payments.push({
      transaction_id: `tx-${sessionId}-zk`,
      amount: pricing.ZK_PROOF_VERIFICATION,
      action: 'ZK_PROOF_VERIFICATION',
      session_id: sessionId,
      from_wallet: wallets.ORCHESTRATOR,
      to_wallet: wallets.SYNTHESIZER,
      created_at: new Date(Date.now() - Math.random() * 86400000).toISOString()
    });
    
    // Insurance premium (1 per session)
    payments.push({
      transaction_id: `tx-${sessionId}-insurance`,
      amount: pricing.INSURANCE_PREMIUM,
      action: 'INSURANCE_PREMIUM',
      session_id: sessionId,
      from_wallet: wallets.ORCHESTRATOR,
      to_wallet: wallets.PROTOCOL,
      created_at: new Date(Date.now() - Math.random() * 86400000).toISOString()
    });
  }
  
  // Insert in batches
  const batchSize = 50;
  for (let i = 0; i < payments.length; i += batchSize) {
    const batch = payments.slice(i, i + batchSize);
    const { error } = await supabase.from('nanopayments').insert(batch);
    if (error) {
      console.error('Error inserting batch:', error);
    } else {
      console.log(`Inserted batch ${i / batchSize + 1}/${Math.ceil(payments.length / batchSize)}`);
    }
  }
  
  console.log(`Seeded ${payments.length} nanopayment records`);
  
  // Print summary
  const { data } = await supabase.from('nanopayments').select('amount');
  if (data) {
    const total = data.reduce((sum, d) => sum + (d.amount || 0), 0);
    console.log(`Total USDC settled: $${total.toFixed(4)}`);
    console.log(`Total transactions: ${data.length}`);
    console.log(`Avg cost per action: $${(total / data.length).toFixed(4)}`);
  }
}

seedNanopayments().catch(console.error);

import { Circle, CircleEnvironments } from '@circle-fin/circle-sdk';

const circle = new Circle(
  process.env.CIRCLE_API_KEY!,
  CircleEnvironments.sandbox  // switch to production for mainnet
);

// Pricing (all in USDC, sub-cent)
export const PRICING = {
  COUNCIL_VOTE: '0.0010',      // $0.001 per agent vote
  ZK_PROOF_VERIFY: '0.0030',   // $0.003 per ZK proof verification
  INSURANCE_PREMIUM: '0.0050', // $0.005 per transaction insured
  BATCH_PROOF: '0.0008',       // $0.0008 per proof in a batch
  SYMBOLIC_CHECK: '0.0020',    // $0.002 per symbolic property check
};

export interface NanopaymentResult {
  transactionId: string;
  amount: string;
  from: string;
  to: string;
  action: string;
  timestamp: string;
}

// Send a nanopayment from one agent wallet to another
export async function sendNanopayment(
  fromWalletId: string,
  toWalletId: string, 
  amount: string,
  action: string,
  sessionId: string
): Promise<NanopaymentResult> {
  try {
    const response = await circle.payouts.createPayout({
      idempotencyKey: `${sessionId}-${action}-${Date.now()}`,
      source: { id: fromWalletId, type: 'wallet' },
      destination: { id: toWalletId, type: 'wallet' },
      amount: { amount, currency: 'USDC' },
      metadata: {
        beneficiaryEmail: 'agent@agentguardian.ai',
        ref: `AgentGuardian:${action}:${sessionId}` 
      }
    });
    
    // Log to Supabase
    await logNanopayment({
      transactionId: response.data?.data?.id || '',
      amount,
      action,
      sessionId,
      fromWalletId,
      toWalletId
    });
    
    return {
      transactionId: response.data?.data?.id || '',
      amount,
      from: fromWalletId,
      to: toWalletId,
      action,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error(`Nanopayment failed for ${action}:`, error);
    throw error;
  }
}

// Log payment to Supabase for UI display
async function logNanopayment(data: {
  transactionId: string;
  amount: string;
  action: string;
  sessionId: string;
  fromWalletId: string;
  toWalletId: string;
}) {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
  
  await supabase.from('nanopayments').insert({
    transaction_id: data.transactionId,
    amount: parseFloat(data.amount),
    action: data.action,
    session_id: data.sessionId,
    from_wallet: data.fromWalletId,
    to_wallet: data.toWalletId,
    created_at: new Date().toISOString()
  });
}

// Create a Circle wallet for an agent
export async function createAgentWallet(
  agentName: string
): Promise<string> {
  const response = await circle.wallets.createWallet({
    idempotencyKey: `wallet-${agentName}-${Date.now()}`,
    description: `AgentGuardian: ${agentName} council agent wallet` 
  });
  return response.data?.data?.walletId || '';
}

// Get wallet balance
export async function getWalletBalance(walletId: string): Promise<string> {
  const response = await circle.wallets.getWallet({ id: walletId });
  const balances = response.data?.data?.balances || [];
  const usdc = balances.find((b: any) => b.currency === 'USD');
  return usdc?.amount || '0';
}

// Get all transactions for dashboard
export async function getNanopaymentHistory(limit = 50) {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
  const { data } = await supabase
    .from('nanopayments')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

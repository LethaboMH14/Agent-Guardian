import { ethers } from 'ethers';
import { AgentGuardian } from '../../typechain-types';
import { AgentPolicy, TransactionRequest, TransactionResponse, GovernanceStats } from '../types';

export class GuardianService {
  private contract: AgentGuardian;
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Signer;

  constructor(contractAddress: string, provider: ethers.JsonRpcProvider, signer: ethers.Signer) {
    this.provider = provider;
    this.signer = signer;
    this.contract = new ethers.Contract(contractAddress, [], signer) as any; // Type assertion needed
  }

  async validateTransaction(request: TransactionRequest): Promise<TransactionResponse> {
    try {
      const tx = await this.contract.validateTransaction(
        request.agent,
        request.recipient,
        ethers.parseUnits(request.amount, 6) // USDC has 6 decimals
      );

      const receipt = await tx.wait();
      
      // Note: Event parsing would need to be implemented based on actual event structure
      return {
        approved: true, // Simplified - would parse from events
        estimatedCost: await this.estimateTransactionCost(request)
      };
    } catch (error) {
      console.error('Transaction validation failed:', error);
      return { approved: false, reason: 'Validation error', estimatedCost: '0' };
    }
  }

  async executeTransaction(
    agent: string,
    recipient: string,
    amount: string,
    approvalId?: string
  ): Promise<string> {
    const tx = await this.contract.executeTransaction(
      agent,
      recipient,
      ethers.parseUnits(amount, 6),
      approvalId || ethers.ZeroHash
    );

    const receipt = await tx.wait();
    return receipt.hash;
  }

  async registerAgent(
    agentAddress: string,
    maxDailySpend: string,
    approvedRecipients: string[],
    requiresHumanApproval: boolean = true,
    minReputationScore: number = 400
  ): Promise<string> {
    const tx = await this.contract.registerAgent(
      agentAddress,
      ethers.parseUnits(maxDailySpend, 6),
      approvedRecipients,
      requiresHumanApproval,
      minReputationScore
    );

    const receipt = await tx.wait();
    return receipt.hash;
  }

  async getAgentPolicy(agentAddress: string): Promise<AgentPolicy> {
    const policy = await this.contract.agentPolicies(agentAddress);
    return {
      owner: policy[0],
      maxDailySpend: ethers.formatUnits(policy[1], 6),
      spentToday: ethers.formatUnits(policy[2], 6),
      lastSpendReset: Number(policy[3]),
      approvedRecipients: policy[4] as string[],
      requiresHumanApproval: policy[5],
      minReputationScore: Number(policy[6]),
      isActive: policy[7]
    };
  }

  async estimateTransactionCost(request: TransactionRequest): Promise<string> {
    // Estimate gas cost in USDC
    const gasEstimate = await this.contract.validateTransaction.estimateGas(
      request.agent,
      request.recipient,
      ethers.parseUnits(request.amount, 6)
    );

    const gasPrice = await this.provider.getFeeData();
    const gasCost = gasEstimate * (gasPrice.gasPrice || 0n);
    
    // Convert to USDC (assuming 1 ETH = 2000 USDC for estimation)
    const usdcCost = gasCost * 2000n / ethers.parseEther('1');
    return ethers.formatUnits(usdcCost, 6);
  }

  async getGovernanceStats(): Promise<GovernanceStats> {
    // Implementation would query contract events and calculate statistics
    // This is a simplified version
    return {
      totalTransactions: 0,
      approvedTransactions: 0,
      rejectedTransactions: 0,
      totalValue: '0',
      averageCost: '0'
    };
  }
}

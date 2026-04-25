/**
 * Type definitions for AgentGuardian system
 */

export interface AgentPolicy {
  owner: string;
  maxDailySpend: string;
  spentToday: string;
  lastSpendReset: number;
  approvedRecipients: string[];
  requiresHumanApproval: boolean;
  minReputationScore: number;
  isActive: boolean;
}

export interface SpendingLimit {
  perTransaction: string;
  daily: string;
  weekly: string;
}

export interface TransactionRequest {
  agent: string;
  recipient: string;
  amount: string;
  description: string;
  metadata?: any;
}

export interface TransactionResponse {
  approved: boolean;
  approvalId?: string;
  reason?: string;
  estimatedCost: string;
}

export interface AgentIdentity {
  tokenId: number;
  name: string;
  description: string;
  capabilities: string;
  owner: string;
  reputation: number;
  creationTime: number;
  verified: boolean;
}

export interface GovernanceStats {
  totalTransactions: number;
  approvedTransactions: number;
  rejectedTransactions: number;
  totalValue: string;
  averageCost: string;
}

export interface CircleConfig {
  apiKey: string;
  appId: string;
  environment: 'sandbox' | 'production';
  walletSetId?: string;
}

// Advanced AI-Powered Features Types

export interface ModelUpdate {
  agent: string;
  modelHash: string;
  timestamp: number;
  weight: number;
}

export interface MLPrediction {
  riskScore: number;
  recommendation: 'APPROVE' | 'REVIEW' | 'REJECT';
  confidence: number;
}

export interface AnomalyDetectionResult {
  anomalies: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  suggestedAction: string;
  anomalyDetails: AnomalyDetail[];
}

export interface AnomalyDetail {
  index: number;
  amount: number;
  zScore: number;
  timestamp: string;
}

export interface YieldStrategy {
  protocol: string;
  allocation: number;
  minAPY: number;
  active: boolean;
}

export interface ServiceListing {
  provider: string;
  serviceType: string;
  price: string;
  minReputation: number;
  active: boolean;
}

export interface DAOProposal {
  proposer: string;
  description: string;
  votesFor: number;
  votesAgainst: number;
  endTime: number;
  executed: boolean;
}

export interface StorageResult {
  ipfsHash: string;
  arweaveId: string;
}

/**
 * Utility functions for AgentGuardian system
 */

import { ethers } from "ethers";
import { TransactionValidationResult } from "./types";

const USDC_DECIMALS = 6;

/**
 * Convert USDC amount from human-readable to wei format
 */
export function parseUSDC(amount: string | number): bigint {
  return ethers.parseUnits(amount.toString(), USDC_DECIMALS);
}

/**
 * Convert USDC amount from wei to human-readable format
 */
export function formatUSDC(amount: bigint): string {
  return ethers.formatUnits(amount, USDC_DECIMALS);
}

/**
 * Calculate gas cost in USDC
 */
export function calculateGasCostInUSDC(gasUsed: bigint, gasPrice: bigint): bigint {
  const gasCostWei = gasUsed * gasPrice;
  // Assuming 1 ETH = 2000 USDC for estimation
  const ethPriceInUSDC = ethers.parseUnits("2000", USDC_DECIMALS);
  return (gasCostWei * ethPriceInUSDC) / ethers.parseEther("1");
}

/**
 * Validate address format
 */
export function isValidAddress(address: string): boolean {
  return ethers.isAddress(address);
}

/**
 * Generate approval ID for human approval workflow
 */
export function generateApprovalId(
  agent: string,
  recipient: string,
  amount: bigint,
  timestamp: number
): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256", "uint256"],
      [agent, recipient, amount, timestamp]
    )
  );
}

/**
 * Calculate reputation score percentage
 */
export function calculateReputationPercentage(score: number, maxScore: number = 1000): number {
  return Math.round((score / maxScore) * 100);
}

/**
 * Calculate success rate from successful and failed transactions
 */
export function calculateSuccessRate(successful: number, failed: number): number {
  const total = successful + failed;
  if (total === 0) return 100;
  return Math.round((successful / total) * 100);
}

/**
 * Check if reputation score meets threshold
 */
export function meetsReputationThreshold(
  score: number,
  threshold: number
): boolean {
  return score >= threshold;
}

/**
 * Format timestamp to readable date
 */
export function formatTimestamp(timestamp: bigint): string {
  return new Date(Number(timestamp) * 1000).toISOString();
}

/**
 * Calculate time until next reset (daily or weekly)
 */
export function calculateTimeUntilReset(
  lastReset: bigint,
  period: "daily" | "weekly"
): number {
  const lastResetDate = new Date(Number(lastReset) * 1000);
  const now = new Date();
  const periodMs = period === "daily" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  
  const nextReset = new Date(lastResetDate.getTime() + periodMs);
  const timeUntilReset = nextReset.getTime() - now.getTime();
  
  return Math.max(0, Math.floor(timeUntilReset / 1000)); // Return seconds
}

/**
 * Validate transaction amount against spending limits
 */
export function validateTransactionAmount(
  amount: bigint,
  perTxLimit: bigint,
  dailyLimit: bigint,
  spentToday: bigint,
  weeklyLimit: bigint,
  spentThisWeek: bigint
): {
  withinPerTx: boolean;
  withinDaily: boolean;
  withinWeekly: boolean;
  canExecute: boolean;
} {
  const withinPerTx = amount <= perTxLimit;
  const withinDaily = spentToday + amount <= dailyLimit;
  const withinWeekly = spentThisWeek + amount <= weeklyLimit;
  const canExecute = withinPerTx && withinDaily && withinWeekly;

  return { withinPerTx, withinDaily, withinWeekly, canExecute };
}

/**
 * Format policy type enum to readable string
 */
export function formatPolicyType(policyType: number): string {
  const types = [
    "SPENDING",
    "DATA_ACCESS",
    "INTERACTION",
    "COMPLIANCE",
    "CUSTOM",
  ];
  return types[policyType] || "UNKNOWN";
}

/**
 * Format policy action enum to readable string
 */
export function formatPolicyAction(action: number): string {
  const actions = ["ALLOW", "DENY", "REQUIRE_APPROVAL", "RATE_LIMIT"];
  return actions[action] || "UNKNOWN";
}

/**
 * Format reputation event type enum to readable string
 */
export function formatReputationEventType(eventType: number): string {
  const types = [
    "SUCCESSFUL_TRANSACTION",
    "FAILED_TRANSACTION",
    "POLICY_VIOLATION",
    "COMPLIANCE_ISSUE",
    "POSITIVE_FEEDBACK",
    "NEGATIVE_FEEDBACK",
    "SECURITY_INCIDENT",
    "RECOVERY_ACTION",
  ];
  return types[eventType] || "UNKNOWN";
}

/**
 * Calculate gas estimate for transaction
 */
export async function estimateGas(
  contract: ethers.Contract,
  method: string,
  ...args: any[]
): Promise<bigint> {
  try {
    const gasEstimate = await contract[method].estimateGas(...args);
    return gasEstimate;
  } catch (error) {
    console.error("Gas estimation failed:", error);
    return BigInt(0);
  }
}

/**
 * Batch transaction validation for multiple recipients
 */
export async function batchValidateTransactions(
  agentGuardian: ethers.Contract,
  agent: string,
  recipients: string[],
  amounts: bigint[]
): Promise<TransactionValidationResult[]> {
  const results: TransactionValidationResult[] = [];

  for (let i = 0; i < recipients.length; i++) {
    try {
      const tx = await agentGuardian.validateTransaction.staticCall(
        agent,
        recipients[i],
        amounts[i]
      );
      results.push({
        approved: tx[0],
        approvalId: tx[1],
      });
    } catch (error) {
      results.push({
        approved: false,
        approvalId: ethers.ZeroHash,
      });
    }
  }

  return results;
}

/**
 * Sleep utility for delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry utility for transaction execution
 */
export async function retryTransaction<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        await sleep(delayMs * (i + 1));
      }
    }
  }

  throw lastError!;
}

/**
 * Check if address is a contract
 */
export async function isContract(
  address: string,
  provider: ethers.Provider
): Promise<boolean> {
  const code = await provider.getCode(address);
  return code !== "0x";
}

export class AnomalyDetectionService {
  private patterns: Map<string, number[]> = new Map();
  private threshold: number = 2; // Standard deviations for anomaly detection
  
  constructor(threshold: number = 2) {
    this.threshold = threshold;
  }
  
  /**
   * Detect anomalies in transaction patterns using statistical analysis
   * @param agent Address of the agent
   * @param transactions Array of transaction data
   * @returns Anomaly detection results with count, risk level, and suggested action
   */
  async detectAnomalies(agent: string, transactions: any[]): Promise<{
    anomalies: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    suggestedAction: string;
    anomalyDetails: any[];
  }> {
    if (transactions.length < 3) {
      return {
        anomalies: 0,
        riskLevel: 'LOW',
        suggestedAction: 'MONITOR',
        anomalyDetails: []
      };
    }
    
    const amounts = transactions.map(tx => parseFloat(tx.amount));
    const mean = this.calculateMean(amounts);
    const stdDev = this.calculateStdDev(amounts, mean);
    
    // Store pattern for future comparison
    this.patterns.set(agent, amounts);
    
    const anomalyDetails: any[] = [];
    const currentAnomalies = amounts.filter((amount, index) => {
      const zScore = Math.abs((amount - mean) / (stdDev || 1));
      if (zScore > this.threshold) {
        anomalyDetails.push({
          index,
          amount,
          zScore,
          timestamp: transactions[index].timestamp
        });
        return true;
      }
      return false;
    }).length;
    
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    let suggestedAction = 'MONITOR';
    
    if (currentAnomalies > 5) {
      riskLevel = 'HIGH';
      suggestedAction = 'FREEZE_AGENT';
    } else if (currentAnomalies > 2) {
      riskLevel = 'MEDIUM';
      suggestedAction = 'REQUIRE_2FA';
    }
    
    return {
      anomalies: currentAnomalies,
      riskLevel,
      suggestedAction,
      anomalyDetails
    };
  }
  
  /**
   * Detect temporal anomalies (unusual timing patterns)
   * @param transactions Array of transaction data with timestamps
   * @returns Temporal anomaly detection results
   */
  async detectTemporalAnomalies(transactions: any[]): Promise<{
    hasAnomalies: boolean;
    anomalies: any[];
  }> {
    if (transactions.length < 5) {
      return { hasAnomalies: false, anomalies: [] };
    }
    
    const timeIntervals: number[] = [];
    for (let i = 1; i < transactions.length; i++) {
      const timeDiff = new Date(transactions[i].timestamp).getTime() - 
                       new Date(transactions[i-1].timestamp).getTime();
      timeIntervals.push(timeDiff);
    }
    
    const meanInterval = this.calculateMean(timeIntervals);
    const stdDevInterval = this.calculateStdDev(timeIntervals, meanInterval);
    
    const anomalies: any[] = [];
    for (let i = 0; i < timeIntervals.length; i++) {
      const zScore = Math.abs((timeIntervals[i] - meanInterval) / (stdDevInterval || 1));
      if (zScore > this.threshold) {
        anomalies.push({
          index: i + 1,
          interval: timeIntervals[i],
          zScore,
          expected: meanInterval
        });
      }
    }
    
    return {
      hasAnomalies: anomalies.length > 0,
      anomalies
    };
  }
  
  /**
   * Detect frequency anomalies (unusual transaction frequency)
   * @param transactions Array of transaction data
   * @param timeWindow Time window in milliseconds to check
   * @param maxFrequency Maximum expected transactions in time window
   * @returns Frequency anomaly detection results
   */
  async detectFrequencyAnomalies(
    transactions: any[],
    timeWindow: number = 3600000, // 1 hour default
    maxFrequency: number = 10
  ): Promise<{
    hasAnomalies: boolean;
    frequency: number;
  }> {
    const now = Date.now();
    const recentTransactions = transactions.filter(tx => {
      const txTime = new Date(tx.timestamp).getTime();
      return now - txTime <= timeWindow;
    });
    
    const frequency = recentTransactions.length;
    const hasAnomalies = frequency > maxFrequency;
    
    return {
      hasAnomalies,
      frequency
    };
  }
  
  /**
   * Calculate mean of an array of numbers
   */
  private calculateMean(values: number[]): number {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  
  /**
   * Calculate standard deviation of an array of numbers
   */
  private calculateStdDev(values: number[], mean: number): number {
    const squaredDiffs = values.map(x => Math.pow(x - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
  }
  
  /**
   * Get stored pattern for an agent
   */
  getAgentPattern(agent: string): number[] | undefined {
    return this.patterns.get(agent);
  }
  
  /**
   * Clear stored pattern for an agent
   */
  clearAgentPattern(agent: string): void {
    this.patterns.delete(agent);
  }
}

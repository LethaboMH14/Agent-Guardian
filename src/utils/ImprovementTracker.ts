export class ImprovementTracker {
  private metrics: Map<string, number[]> = new Map();
  
  trackMetric(metricName: string, value: number): void {
    if (!this.metrics.has(metricName)) {
      this.metrics.set(metricName, []);
    }
    this.metrics.get(metricName)!.push(value);
  }
  
  getImprovementRate(metricName: string): number {
    const values = this.metrics.get(metricName);
    if (!values || values.length < 2) return 0;
    
    const first = values[0];
    const last = values[values.length - 1];
    return ((first - last) / first) * 100;
  }
  
  generateReport(): string {
    let report = "AgentGuardian Improvement Report\n";
    report += "================================\n\n";
    
    for (const [metric, values] of this.metrics) {
      if (values.length >= 2) {
        const improvement = this.getImprovementRate(metric);
        report += `${metric}: ${improvement.toFixed(2)}% improvement\n`;
      }
    }
    
    return report;
  }
}

// Usage example:
const tracker = new ImprovementTracker();
tracker.trackMetric('TransactionCost', 0.005); // Initial cost
tracker.trackMetric('TransactionCost', 0.003); // Improved cost
console.log(tracker.generateReport());

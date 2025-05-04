// src/server/agent/history/strategies/strategy-factory.ts
import { TraditionalSummarizationStrategy } from './traditional-strategy';
import { CostOptimizedSummarizationStrategy } from './cost-optimized-strategy';
import { ImportanceAwareTraditionalStrategy } from './importance-aware-traditional-strategy';
import { ImportanceAwareCostOptimizedStrategy } from './importance-aware-cost-optimized-strategy';
import { SummarizationStrategy } from './types';

/**
 * Factory class for creating appropriate summarization strategies.
 * This provides a clean way to instantiate the right strategy based on configuration.
 */
export class SummarizationStrategyFactory {
  /**
   * Creates the appropriate strategy based on configuration
   * 
   * @param useImportanceScoring Whether to use importance scoring
   * @param useCostOptimization Whether to use cost optimization
   * @returns The appropriate summarization strategy
   */
  static createStrategy(useImportanceScoring: boolean, useCostOptimization: boolean): SummarizationStrategy {
    if (useImportanceScoring) {
      return useCostOptimization 
        ? new ImportanceAwareCostOptimizedStrategy()
        : new ImportanceAwareTraditionalStrategy();
    } else {
      return useCostOptimization
        ? new CostOptimizedSummarizationStrategy()
        : new TraditionalSummarizationStrategy();
    }
  }
}
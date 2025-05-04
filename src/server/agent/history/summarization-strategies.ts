// src/server/agent/history/summarization-strategies.ts
// Barrel file that re-exports all strategy-related components for convenient imports

// Export the interface and base class
export { BaseSummarizationStrategy } from './strategies/base-strategy';

// Export concrete strategy implementations
export { TraditionalSummarizationStrategy } from './strategies/traditional-strategy';
export { CostOptimizedSummarizationStrategy } from './strategies/cost-optimized-strategy';
export { ImportanceAwareTraditionalStrategy } from './strategies/importance-aware-traditional-strategy';
export { ImportanceAwareCostOptimizedStrategy } from './strategies/importance-aware-cost-optimized-strategy';

// Export the factory
export { SummarizationStrategyFactory } from './strategies/strategy-factory';
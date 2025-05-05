// src/server/agent/history/strategies/strategy-factory.ts
import { SummarizationStrategy } from './types';
import { TraditionalSummarizationStrategy } from './traditional-strategy';
import { CostOptimizedSummarizationStrategy } from './cost-optimized-strategy';
import { ImportanceAwareTraditionalStrategy } from './importance-aware-traditional-strategy';
import { ImportanceAwareCostOptimizedStrategy } from './importance-aware-cost-optimized-strategy';

// Import decorators
import { CodePreservingDecorator } from './decorators/code-preserving-decorator';
import { ReferencePreservingDecorator } from './decorators/reference-preserving-decorator';
import { OpenQuestionPreservingDecorator } from './decorators/open-question-preserving-decorator';
import { VerbosityReducingDecorator } from './decorators/verbosity-reducing-decorator';

/**
 * Configuration options for strategy creation and composition
 */
export interface StrategyOptions {
  // Base strategy options
  useImportanceScoring?: boolean;
  useCostOptimization?: boolean;

  // Decorator options
  preserveCodeBlocks?: boolean;
  preserveReferences?: boolean;
  preserveOpenQuestions?: boolean;
  reduceVerbosity?: boolean;
  summarizationAggressiveness?: 'normal' | 'high'; // Added from types.ts
}

/**
 * Factory class for creating appropriate summarization strategies.
 * This provides a clean way to instantiate and compose the right strategies based on configuration.
 */
export class SummarizationStrategyFactory {
  /**
   * Creates the appropriate strategy based on configuration
   *
   * @param options Configuration options for strategy creation
   * @returns The appropriate summarization strategy, potentially decorated with additional behaviors
   */
  static createStrategy(options: StrategyOptions = {}): SummarizationStrategy {
    const {
      useImportanceScoring = false,
      useCostOptimization = false,
      preserveCodeBlocks = false,
      preserveReferences = false,
      preserveOpenQuestions = false,
      reduceVerbosity = false,
      summarizationAggressiveness = 'normal' // Default to normal
    } = options;

    // Define base strategy options object to pass to constructors
    const baseStrategyOptions = { summarizationAggressiveness };

    // Create the base strategy, passing aggressiveness level
    let strategy: SummarizationStrategy;

    if (useImportanceScoring) {
      strategy = useCostOptimization
        ? new ImportanceAwareCostOptimizedStrategy(baseStrategyOptions) // Pass options object
        : new ImportanceAwareTraditionalStrategy(baseStrategyOptions); // Pass options object
    } else {
      strategy = useCostOptimization
        ? new CostOptimizedSummarizationStrategy(baseStrategyOptions) // Pass options object
        : new TraditionalSummarizationStrategy(baseStrategyOptions); // Pass options object
    }

    // Apply decorators based on options
    if (preserveCodeBlocks) {
      strategy = new CodePreservingDecorator(strategy);
    }

    if (preserveReferences) {
      strategy = new ReferencePreservingDecorator(strategy);
    }

    if (preserveOpenQuestions) {
      strategy = new OpenQuestionPreservingDecorator(strategy);
    }

    if (reduceVerbosity) {
      // Potentially adjust VerbosityReducingDecorator based on aggressiveness too?
      // For now, keep it separate.
      strategy = new VerbosityReducingDecorator(strategy);
    }

    return strategy;
  }

  /**
   * Creates a strategy with all decorators applied
   * This is a convenience method for quickly creating a fully-featured strategy
   *
   * @param useImportanceScoring Whether to use importance scoring
   * @param useCostOptimization Whether to use cost optimization
   * @returns A fully decorated strategy with all preservers applied
   */
  static createComprehensiveStrategy(useImportanceScoring: boolean, useCostOptimization: boolean): SummarizationStrategy {
    // Note: This doesn't currently pass aggressiveness. Decide if it should default or take another param.
    // For now, it will use the default 'normal' aggressiveness from createStrategy.
    return this.createStrategy({
      useImportanceScoring,
      useCostOptimization,
      preserveCodeBlocks: true,
      preserveReferences: true,
      preserveOpenQuestions: true,
      reduceVerbosity: true
      // summarizationAggressiveness: 'normal', // Explicitly normal if needed
    });
  }
}
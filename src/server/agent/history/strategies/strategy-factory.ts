// src/server/agent/history/strategies/strategy-factory.ts
import { SummarizationStrategy } from './base-strategy';
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
      reduceVerbosity = false
    } = options;
    
    // Create the base strategy
    let strategy: SummarizationStrategy;
    
    if (useImportanceScoring) {
      strategy = useCostOptimization 
        ? new ImportanceAwareCostOptimizedStrategy()
        : new ImportanceAwareTraditionalStrategy();
    } else {
      strategy = useCostOptimization
        ? new CostOptimizedSummarizationStrategy()
        : new TraditionalSummarizationStrategy();
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
    return this.createStrategy({
      useImportanceScoring,
      useCostOptimization,
      preserveCodeBlocks: true,
      preserveReferences: true,
      preserveOpenQuestions: true,
      reduceVerbosity: true
    });
  }
}
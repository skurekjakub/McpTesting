// src/server/agent/history/strategies/base-decorator.ts
import { Content } from '@google/generative-ai';
import { SummarizationStrategy } from '../types';

/**
 * Base decorator class for implementing the Decorator pattern with summarization strategies.
 * This enables composition of multiple summarization strategies by wrapping them in decorators
 * that add specific behaviors while maintaining the same interface.
 */
export abstract class StrategySummarizationDecorator implements SummarizationStrategy {
  /**
   * Constructor for the decorator
   * @param baseStrategy The strategy being decorated/wrapped
   */
  constructor(protected readonly baseStrategy: SummarizationStrategy) {}
  
  /**
   * Implement the summarize method from the SummarizationStrategy interface
   * Concrete decorators will override this to add their behavior
   */
  abstract summarize(history: Content[]): Promise<Content[]>;
  
  /**
   * Create a composite name that shows the decorator chain
   */
  get name(): string {
    return `${this.getDecoratorName()}+${this.baseStrategy.name}`;
  }
  
  /**
   * Get a detailed description of the strategy composition
   */
  getDescription(): string {
    return `${this.getDecoratorDescription()} with ${this.baseStrategy.getDescription ? 
      this.baseStrategy.getDescription() : this.baseStrategy.name}`;
  }
  
  /**
   * Get the name of this specific decorator
   */
  protected abstract getDecoratorName(): string;
  
  /**
   * Get a description of what this decorator does
   */
  protected abstract getDecoratorDescription(): string;
}
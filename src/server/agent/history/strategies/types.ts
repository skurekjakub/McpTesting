import { Content } from "@google/generative-ai";

/**
 * Interface for all summarization strategies to implement.
 * This ensures a consistent API across different summarization approaches.
 */
export interface SummarizationStrategy {
  /**
   * Summarizes conversation history according to the strategy's implementation.
   * 
   * @param history The conversation history to summarize
   * @returns Processed history with summarization applied
   */
  summarize(history: Content[]): Promise<Content[]>;

  /**
   * Returns a name for the strategy, used for logging and identification.
   */
  getDescription?(): string;

  /**
   * Strategy name to identify the strategy for logging
   */
  readonly name: string;
}
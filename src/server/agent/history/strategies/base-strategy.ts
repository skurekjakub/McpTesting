// src/server/agent/history/strategies/base-strategy.ts
import { Content } from '@google/generative-ai';

import { SummarizationStrategy } from './types';

import logger from '../../../logger';
import { agentConfig } from '../../agent-config';
import { countTokensForHistory } from '../../../llm/gemini/tokenization';

/**
 * Base class for summarization strategies to share common functionality.
 */
export abstract class BaseSummarizationStrategy implements SummarizationStrategy {
  abstract summarize(history: Content[]): Promise<Content[]>;
  abstract readonly name: string;
  
  /**
   * Creates a summary message with the appropriate prefix
   */
  protected createSummaryMessage(summaryText: string): Content {
    return {
      role: 'model',
      parts: [{ text: `${agentConfig.history.summaryMessagePrefix}${summaryText}` }]
    };
  }
  
  /**
   * Logs a message with the appropriate history manager prefix
   */
  protected log(message: string): void {
    logger.info(`${agentConfig.logging.historyManager} ${message}`);
  }
  
  /**
   * Checks if summarization is needed based on token threshold
   */
  protected async shouldSummarize(history: Content[]): Promise<boolean> {
    const tokenCount = await countTokensForHistory(history);
    return tokenCount > agentConfig.summarization.threshold;
  }
}
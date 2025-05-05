// src/server/agent/history/strategies/traditional-strategy.ts
import { Content } from '@google/generative-ai';
import { agentConfig } from '../../agent-config';
import { summarizeHistory } from '../../../llm/gemini/summarization';
import { countTokensForHistory } from '../../../llm/gemini/tokenization';
import { BaseSummarizationStrategy } from './base-strategy';
import { SummarizationMode } from '../types'; // Import SummarizationMode

/**
 * Options for base summarization strategies
 */
interface BaseStrategyOptions {
  summarizationAggressiveness?: 'normal' | 'high';
}

/**
 * Traditional summarization strategy that preserves the first user message and the most recent messages.
 */
export class TraditionalSummarizationStrategy extends BaseSummarizationStrategy {
  readonly name = 'traditional';
  private summarizationMode: SummarizationMode;

  constructor(options: BaseStrategyOptions = {}) {
    super();
    this.summarizationMode = options.summarizationAggressiveness === 'high' ? 'aggressive' : 'standard';
    this.log(`Initialized with summarization mode: ${this.summarizationMode}`);
  }

  async summarize(history: Content[]): Promise<Content[]> {
    if (history.length <= agentConfig.history.messagesToKeepUnsummarized + 1) {
      return history; // Not enough messages to summarize
    }

    const firstUserMessageIndex = 0; // Assuming first message is always user
    const startIndexToSummarize = firstUserMessageIndex + 1;
    const endIndexToSummarize = Math.max(
      startIndexToSummarize, 
      history.length - agentConfig.history.messagesToKeepUnsummarized
    );

    if (endIndexToSummarize <= startIndexToSummarize) {
      this.log('Not enough messages to summarize between first and recent messages.');
      return history;
    }

    const historyToSummarize = history.slice(startIndexToSummarize, endIndexToSummarize);
    // Pass the determined summarization mode to the LLM call
    const summaryText = await summarizeHistory(historyToSummarize, this.summarizationMode);

    if (!summaryText) {
      this.log('Summarization failed or returned empty. Proceeding with original history.');
      return history;
    }

    const summaryMessage = this.createSummaryMessage(summaryText);

    // Replace the summarized section with the summary message
    const summarizedHistory = [
      ...history.slice(0, startIndexToSummarize),
      summaryMessage,
      ...history.slice(endIndexToSummarize)
    ];

    const newTokenCount = await countTokensForHistory(summarizedHistory);
    this.log(`History summarized using ${this.name} method (${this.summarizationMode}). New token count: ${newTokenCount}`);

    return summarizedHistory;
  }
}
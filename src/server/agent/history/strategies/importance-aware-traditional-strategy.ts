// src/server/agent/history/strategies/importance-aware-traditional-strategy.ts
import { Content } from '@google/generative-ai';
import { agentConfig } from '../../agent-config';
import { summarizeHistory } from '../../../llm/gemini/summarization';
import { countTokensForHistory } from '../../../llm/gemini/tokenization';
import { BaseSummarizationStrategy } from './base-strategy';
import { ScoredMessage, SummarizationMode } from '../types'; // Import SummarizationMode

/**
 * Options for base summarization strategies
 */
interface BaseStrategyOptions {
  summarizationAggressiveness?: 'normal' | 'high';
}

/**
 * Importance-aware traditional summarization that preserves important messages.
 */
export class ImportanceAwareTraditionalStrategy extends BaseSummarizationStrategy {
  readonly name = 'importance-aware-traditional';
  private summarizationMode: SummarizationMode;

  constructor(options: BaseStrategyOptions = {}) {
    super();
    this.summarizationMode = options.summarizationAggressiveness === 'high' ? 'aggressive' : 'standard';
    this.log(`Initialized with summarization mode: ${this.summarizationMode}`);
  }

  async summarize(scoredHistory: ScoredMessage[]): Promise<Content[]> {
    const firstUserMessageIndex = 0; // Assuming first message is always user
    const startIndexToSummarize = firstUserMessageIndex + 1;

    // Calculate the end index, respecting the configured number of recent messages to keep
    const endIndexToSummarize = Math.max(
      startIndexToSummarize,
      scoredHistory.length - agentConfig.history.messagesToKeepUnsummarized
    );

    if (endIndexToSummarize <= startIndexToSummarize) {
      this.log('Not enough messages to summarize with importance scoring.');
      return scoredHistory;
    }

    // Extract the section to potentially summarize
    const sectionToProcess = scoredHistory.slice(startIndexToSummarize, endIndexToSummarize);

    // Identify highly important messages to keep intact based on score
    const importantMessagesToKeep = sectionToProcess.filter(msg =>
      (msg.importanceScore || 0) >= agentConfig.importanceScoring.minImportanceScoreToPreserve
    );

    const otherMessagesToSummarize = sectionToProcess.filter(msg =>
      (msg.importanceScore || 0) < agentConfig.importanceScoring.minImportanceScoreToPreserve
    );

    // If there's nothing to summarize after keeping important messages, return as is
    if (otherMessagesToSummarize.length === 0) {
      this.log('All messages in section deemed important, skipping summarization.');
      return scoredHistory;
    }

    // Summarize the less important messages using the determined mode
    const summaryText = await summarizeHistory(otherMessagesToSummarize, this.summarizationMode);

    if (!summaryText) {
      this.log('Summarization failed, preserving original history.');
      return scoredHistory;
    }

    // Create the summary message
    const summaryMessage = this.createSummaryMessage(summaryText);

    // Rebuild the history combining:
    // 1. The beginning part (before summarization section)
    // 2. Highly important messages that were kept intact
    // 3. The summary of less important messages
    // 4. The end part (after summarization section)
    const result = [
      ...scoredHistory.slice(0, startIndexToSummarize),
      ...importantMessagesToKeep,
      summaryMessage,
      ...scoredHistory.slice(endIndexToSummarize)
    ];

    const newTokenCount = await countTokensForHistory(result);
    this.log(`History summarized using ${this.name} method (${this.summarizationMode}). New token count: ${newTokenCount}`);

    return result;
  }
}
// src/server/agent/history/strategies/cost-optimized-strategy.ts
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
 * Cost-optimized summarization that aggressively summarizes older history.
 */
export class CostOptimizedSummarizationStrategy extends BaseSummarizationStrategy {
  readonly name = 'cost-optimized';
  private summarizationMode: SummarizationMode;

  constructor(options: BaseStrategyOptions = {}) {
    super();
    // Determine mode based on option, potentially overriding internal logic if 'high' is forced
    this.summarizationMode = options.summarizationAggressiveness === 'high' ? 'aggressive' : 'standard';
    this.log(`Initialized with base summarization mode: ${this.summarizationMode}`);
  }

  async summarize(history: Content[]): Promise<Content[]> {
    if (history.length <= agentConfig.summarization.recentMessagesToPreserve) {
      return history; // Not enough messages to summarize
    }

    // Keep recent messages intact
    const recentMessages = history.slice(-agentConfig.summarization.recentMessagesToPreserve);

    // Summarize older history
    const olderHistory = history.slice(0, -agentConfig.summarization.recentMessagesToPreserve);

    // Calculate token count to potentially override mode for very long histories
    const estimatedTokens = await countTokensForHistory(olderHistory);

    let finalSummarizationMode = this.summarizationMode;
    // If not already aggressive, check if deep history threshold triggers it
    if (finalSummarizationMode === 'standard' && estimatedTokens > agentConfig.summarization.deepHistoryThreshold) {
      this.log(`Deep history threshold (${agentConfig.summarization.deepHistoryThreshold} tokens) exceeded (${estimatedTokens} tokens). Switching to aggressive summarization.`);
      finalSummarizationMode = 'aggressive';
    } else {
      this.log(`Using ${finalSummarizationMode} summarization for ${estimatedTokens} tokens of older history.`);
    }

    // Pass the final determined summarization mode to the LLM call
    const summaryText = await summarizeHistory(olderHistory, finalSummarizationMode);

    if (!summaryText) {
      this.log('Summarization failed or returned empty. Proceeding with original history.');
      return history;
    }

    const summarizedHistory = [
      this.createSummaryMessage(summaryText),
      ...recentMessages
    ];

    const newTokenCount = await countTokensForHistory(summarizedHistory);
    this.log(`History summarized using ${this.name} method (${finalSummarizationMode}). New token count: ${newTokenCount}`);

    return summarizedHistory;
  }
}
// src/server/agent/history/strategies/cost-optimized-strategy.ts
import { Content } from '@google/generative-ai';
import { agentConfig } from '../../agent-config';
import { summarizeHistory } from '../../../llm/gemini/summarization';
import { countTokensForHistory } from '../../../llm/gemini/tokenization';
import { BaseSummarizationStrategy } from './base-strategy';

/**
 * Cost-optimized summarization that aggressively summarizes older history.
 */
export class CostOptimizedSummarizationStrategy extends BaseSummarizationStrategy {
  readonly name = 'cost-optimized';
  
  async summarize(history: Content[]): Promise<Content[]> {
    if (history.length <= agentConfig.summarization.recentMessagesToPreserve) {
      return history; // Not enough messages to summarize
    }
    
    // Keep recent messages intact
    const recentMessages = history.slice(-agentConfig.summarization.recentMessagesToPreserve);
    
    // Summarize older history
    const olderHistory = history.slice(0, -agentConfig.summarization.recentMessagesToPreserve);
    
    // Calculate token count to determine summarization approach
    const estimatedTokens = await countTokensForHistory(olderHistory);
    
    let summaryText: string | null;
    
    if (estimatedTokens > agentConfig.summarization.deepHistoryThreshold) {
      // More aggressive summarization for very long histories
      this.log(`Using aggressive summarization for ${estimatedTokens} tokens of older history`);
      summaryText = await summarizeHistory(olderHistory, 'aggressive');
    } else {
      this.log(`Using standard summarization for ${estimatedTokens} tokens of older history`);
      summaryText = await summarizeHistory(olderHistory, 'standard');
    }
    
    if (!summaryText) {
      this.log('Summarization failed or returned empty. Proceeding with original history.');
      return history;
    }
    
    const summarizedHistory = [
      this.createSummaryMessage(summaryText),
      ...recentMessages
    ];
    
    const newTokenCount = await countTokensForHistory(summarizedHistory);
    this.log(`History summarized using cost-optimized method. New token count: ${newTokenCount}`);
    
    return summarizedHistory;
  }
}
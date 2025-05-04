// src/server/agent/history/strategies/importance-aware-cost-optimized-strategy.ts
import { Content } from '@google/generative-ai';
import { agentConfig } from '../../agent-config';
import { summarizeHistory } from '../../../llm/gemini/summarization';
import { countTokensForHistory } from '../../../llm/gemini/tokenization';
import { BaseSummarizationStrategy } from './base-strategy';
import { ScoredMessage } from '../types';

/**
 * Importance-aware cost-optimized summarization that preserves important messages while 
 * being cost-efficient for long conversations.
 */
export class ImportanceAwareCostOptimizedStrategy extends BaseSummarizationStrategy {
  readonly name = 'importance-aware-cost-optimized';
  
  async summarize(scoredHistory: ScoredMessage[]): Promise<Content[]> {
    if (scoredHistory.length <= agentConfig.summarization.recentMessagesToPreserve) {
      return scoredHistory; // Too small to summarize
    }
    
    // Keep recent messages intact (as in the original cost optimization approach)
    const recentMessages = scoredHistory.slice(-agentConfig.summarization.recentMessagesToPreserve);
    
    // Process older history with importance scoring
    const olderHistory = scoredHistory.slice(0, -agentConfig.summarization.recentMessagesToPreserve);
    
    // Identify highly important messages to keep intact
    const importantOlderMessages = olderHistory.filter(msg => 
      (msg.importanceScore || 0) >= agentConfig.importanceScoring.minImportanceScoreToPreserve
    );
    
    // Other messages that can be summarized
    const messagesToSummarize = olderHistory.filter(msg => 
      (msg.importanceScore || 0) < agentConfig.importanceScoring.minImportanceScoreToPreserve
    );
    
    if (messagesToSummarize.length === 0) {
      this.log('All older messages deemed important, skipping summarization.');
      return [...importantOlderMessages, ...recentMessages];
    }
    
    // Calculate tokens to determine summarization approach
    const estimatedTokens = await countTokensForHistory(messagesToSummarize);
    
    let summaryText: string | null;
    
    if (estimatedTokens > agentConfig.summarization.deepHistoryThreshold) {
      // Use more aggressive summarization for very long histories
      this.log(`Using aggressive summarization for ${estimatedTokens} tokens of less important older history`);
      summaryText = await summarizeHistory(messagesToSummarize, 'aggressive');
    } else {
      // Use standard summarization for moderate histories
      this.log(`Using standard summarization for ${estimatedTokens} tokens of less important older history`);
      summaryText = await summarizeHistory(messagesToSummarize, 'standard');
    }
    
    if (!summaryText) {
      this.log('Summarization failed, preserving all original history.');
      return [...olderHistory, ...recentMessages];
    }
    
    // Create summary message
    const summaryMessage = this.createSummaryMessage(summaryText);
    
    // Return the important older messages + summary of less important messages + recent messages
    const result = [...importantOlderMessages, summaryMessage, ...recentMessages];
    
    const newTokenCount = await countTokensForHistory(result);
    this.log(`History summarized using importance-aware cost-optimized method. New token count: ${newTokenCount}`);
    
    return result;
  }
}
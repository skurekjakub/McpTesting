// src/server/agent/history/strategies/importance-aware-cost-optimized-strategy.ts
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
 * Importance-aware cost-optimized summarization that preserves important messages while 
 * being cost-efficient for long conversations.
 */
export class ImportanceAwareCostOptimizedStrategy extends BaseSummarizationStrategy {
  readonly name = 'importance-aware-cost-optimized';
  private summarizationMode: SummarizationMode;

  constructor(options: BaseStrategyOptions = {}) {
    super();
    this.summarizationMode = options.summarizationAggressiveness === 'high' ? 'aggressive' : 'standard';
    this.log(`Initialized with base summarization mode: ${this.summarizationMode}`);
  }

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
    
    let finalSummarizationMode = this.summarizationMode;
    // If not already aggressive, check if deep history threshold triggers it
    if (finalSummarizationMode === 'standard' && estimatedTokens > agentConfig.summarization.deepHistoryThreshold) {
      this.log(`Deep history threshold (${agentConfig.summarization.deepHistoryThreshold} tokens) exceeded (${estimatedTokens} tokens). Switching to aggressive summarization.`);
      finalSummarizationMode = 'aggressive';
    } else {
      this.log(`Using ${finalSummarizationMode} summarization for ${estimatedTokens} tokens of less important older history`);
    }
    
    // Summarize using the final determined mode
    const summaryText = await summarizeHistory(messagesToSummarize, finalSummarizationMode);
    
    if (!summaryText) {
      this.log('Summarization failed, preserving all original older history + recent.');
      return [...olderHistory, ...recentMessages];
    }
    
    // Create summary message
    const summaryMessage = this.createSummaryMessage(summaryText);
    
    // Return the important older messages + summary of less important messages + recent messages
    const result = [...importantOlderMessages, summaryMessage, ...recentMessages];
    
    const newTokenCount = await countTokensForHistory(result);
    this.log(`History summarized using ${this.name} method (${finalSummarizationMode}). New token count: ${newTokenCount}`);
    
    return result;
  }
}
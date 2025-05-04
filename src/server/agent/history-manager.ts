// src/server/agent/history-manager.ts
import { Content } from '@google/generative-ai';

import logger from '../logger';
import { agentConfig as configModuleAgentConfig } from './agent-config';
import { countTokensForHistory } from '../llm/gemini/tokenization';
import { summarizeHistory, summarizeHistoryCostOptimized } from '../llm/gemini/summarization';

/**
 * Manages conversation history, including summarization when needed.
 * Follows Single Responsibility Principle by focusing purely on history management.
 */
export class HistoryManager {
  /**
   * Processes the conversation history, applying summarization if token threshold is exceeded.
   * 
   * @param history The current conversation history
   * @param newUserMessage Optional new user message to append before processing
   * @param logCallback Optional callback for logging/observability
   * @returns Processed history with summarization applied if needed
   */
  async processHistory(
    history: Content[], 
    newUserMessage?: string,
    logCallback?: (message: string) => void
  ): Promise<Content[]> {
    const logStep = (message: string) => {
      logger.info(`${configModuleAgentConfig.logging.historyManager} ${message}`);
      if (logCallback) logCallback(message);
    };
    
    // Create a copy to work with
    const processedHistory = [...history];
    
    // Add new message if provided
    if (newUserMessage) {
      processedHistory.push({
        role: 'user',
        parts: [{ text: newUserMessage }]
      });
      logStep(`Added user message (${newUserMessage.length} chars) to history`);
    }
    
    // Check if we need to summarize
    const tokenCount = await countTokensForHistory(processedHistory);
    logStep(`Current history token count: ${tokenCount}`);
    
    if (tokenCount <= configModuleAgentConfig.summarization.threshold) {
      return processedHistory; // No summarization needed
    }
    
    logStep(`Token threshold (${configModuleAgentConfig.summarization.threshold}) exceeded. Applying summarization.`);
    
    // Apply appropriate summarization strategy
    if (configModuleAgentConfig.summarization.costOptimizationEnabled) {
      logStep('Using cost-optimized progressive summarization strategy');
      const summarizedHistory = await summarizeHistoryCostOptimized(processedHistory);
      
      const newTokenCount = await countTokensForHistory(summarizedHistory);
      logStep(`History summarized with cost optimization. New token count: ${newTokenCount}`);
      
      return summarizedHistory;
    } else {
      // Traditional summarization approach
      const firstUserMessageIndex = 0; // Assuming first message is always user
      const startIndexToSummarize = firstUserMessageIndex + 1;
      const endIndexToSummarize = Math.max(
        startIndexToSummarize, 
        processedHistory.length - configModuleAgentConfig.history.messagesToKeepUnsummarized
      );

      if (endIndexToSummarize <= startIndexToSummarize) {
        logStep('Not enough messages to summarize between first and recent messages.');
        return processedHistory;
      }
      
      const historyToSummarize = processedHistory.slice(startIndexToSummarize, endIndexToSummarize);
      const summaryText = await summarizeHistory(historyToSummarize);

      if (!summaryText) {
        logStep('Summarization failed or returned empty. Proceeding with original history.');
        return processedHistory;
      }

      // Create the summary message
      const summaryMessage: Content = {
        role: 'model',
        parts: [{ text: `${configModuleAgentConfig.history.summaryMessagePrefix}${summaryText}` }]
      };

      // Replace the summarized section with the summary message
      const summarizedHistory = [
        ...processedHistory.slice(0, startIndexToSummarize),
        summaryMessage,
        ...processedHistory.slice(endIndexToSummarize)
      ];

      const newTokenCount = await countTokensForHistory(summarizedHistory);
      logStep(`History summarized using traditional method. New token count: ${newTokenCount}`);
      
      return summarizedHistory;
    }
  }
  
  /**
   * Check if the last two messages in history are duplicated model responses.
   * If so, remove the last message to avoid redundancy.
   */
  cleanupDuplicateResponses(history: Content[]): Content[] {
    if (history.length < 2) return history;
    
    const last = history[history.length - 1];
    const secondLast = history[history.length - 2];
    
    // Check if both are model messages with identical text content
    if (
      last.role === 'model' &&
      secondLast.role === 'model' &&
      this.getTextContent(last) === this.getTextContent(secondLast)
    ) {
      logger.warn(`${configModuleAgentConfig.logging.historyManager} Removing duplicate model message from end of history.`);
      return history.slice(0, history.length - 1);
    }
    
    return history;
  }
  
  /**
   * Helper to extract text content from a Content object
   */
  private getTextContent(content: Content): string {
    return content.parts
      .map(part => typeof part === 'object' && 'text' in part ? part.text : '')
      .join('');
  }
}
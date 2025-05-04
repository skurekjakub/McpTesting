// src/server/agent/history-manager.ts
import { Content } from '@google/generative-ai';

import logger from '../logger';
import { agentConfig } from './agent-config';
import { countTokensForHistory } from '../llm/gemini/tokenization';

// Import specialized services from history subfolder
import { ImportanceScorer } from './history/importance-scorer';
import { SummarizationStrategyFactory } from './history/summarization-strategies';
import { HistoryCleanupService } from './history/cleanup-service';
import { MessageUtils } from './history/message-utils';
import { LogCallback } from './history/types';

/**
 * Manages conversation history, including summarization when needed.
 * Acts as a facade for the various specialized history management services.
 */
export class HistoryManager {
  private importanceScorer: ImportanceScorer;
  private cleanupService: HistoryCleanupService;
  
  constructor() {
    this.importanceScorer = new ImportanceScorer();
    this.cleanupService = new HistoryCleanupService();
  }

  /**
   * Processes the conversation history, applying summarization if token threshold is exceeded.
   * This is the main entry point for history management.
   * 
   * @param history The current conversation history
   * @param newUserMessage Optional new user message to append before processing
   * @param logCallback Optional callback for logging/observability
   * @returns Processed history with summarization applied if needed
   */
  async processHistory(
    history: Content[], 
    newUserMessage?: string,
    logCallback?: LogCallback
  ): Promise<Content[]> {
    const logStep = (message: string) => {
      logger.info(`${agentConfig.logging.historyManager} ${message}`);
      if (logCallback) logCallback(message);
    };
    
    // Create a copy to work with
    let processedHistory = [...history];
    
    // Add new message if provided
    if (newUserMessage) {
      processedHistory.push(MessageUtils.createUserMessage(newUserMessage));
      logStep(`Added user message (${newUserMessage.length} chars) to history`);
    }
    
    // Check if we need to summarize
    const tokenCount = await countTokensForHistory(processedHistory);
    logStep(`Current history token count: ${tokenCount}`);
    
    if (tokenCount <= agentConfig.summarization.threshold) {
      return processedHistory; // No summarization needed
    }
    
    logStep(`Token threshold (${agentConfig.summarization.threshold}) exceeded. Applying summarization.`);

    // Get the appropriate summarization strategy based on configuration
    const useImportanceScoring = agentConfig.importanceScoring.enabled;
    const useCostOptimization = agentConfig.summarization.costOptimizationEnabled;
    
    // Create the appropriate strategy via factory
    const strategy = SummarizationStrategyFactory.createStrategy(
      useImportanceScoring,
      useCostOptimization
    );
    
    logStep(`Using ${strategy.name} summarization strategy`);
    
    // Apply importance scoring if the strategy requires it
    if (useImportanceScoring) {
      logStep('Applying contextual importance scoring to identify key messages to preserve');
      const scoredHistory = this.importanceScorer.scoreHistoryImportance(processedHistory);
      processedHistory = await strategy.summarize(scoredHistory);
    } else {
      processedHistory = await strategy.summarize(processedHistory);
    }
    
    const newTokenCount = await countTokensForHistory(processedHistory);
    logStep(`History summarized successfully. New token count: ${newTokenCount}`);
    
    return processedHistory;
  }
  
  /**
   * Check if the last two messages in history are duplicated model responses.
   * If so, remove the last message to avoid redundancy.
   */
  cleanupDuplicateResponses(history: Content[]): Content[] {
    return this.cleanupService.cleanupDuplicateResponses(history);
  }
  
  /**
   * Removes empty messages from the history
   */
  cleanupEmptyMessages(history: Content[]): Content[] {
    return this.cleanupService.removeEmptyMessages(history);
  }
}
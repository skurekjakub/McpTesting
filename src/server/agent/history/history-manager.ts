// src/server/agent/history-manager.ts
import { Content } from '@google/generative-ai';

import logger from '../../logger';
import { agentConfig } from '../agent-config';
import { countTokensForHistory } from '../../llm/gemini/tokenization';

// Import specialized services from history subfolder
import { ImportanceScorer } from './importance-scorer';
import { SummarizationStrategyFactory } from './strategies/strategy-factory';
import { HistoryCleanupService } from './cleanup-service';
import { MessageUtils } from './message-utils';
import { LogCallback } from './types';
import { StrategyOptions } from './strategies/strategy-factory';

/**
 * Manages conversation history, including summarization when needed.
 * Acts as a facade for the various specialized history management services.
 */
export class HistoryManager {
  private importanceScorer: ImportanceScorer;
  private cleanupService: HistoryCleanupService;
  private strategyOptions: StrategyOptions;
  private cachedStrategy: any = null; // Used to cache the last created strategy
  
  constructor(strategyOptions?: Partial<StrategyOptions>) {
    this.importanceScorer = new ImportanceScorer();
    this.cleanupService = new HistoryCleanupService();
    
    // Default strategy options with smart defaults for programming contexts
    this.strategyOptions = {
      useImportanceScoring: agentConfig.importanceScoring.enabled,
      useCostOptimization: agentConfig.summarization.costOptimizationEnabled,
      preserveCodeBlocks: true,      // Default to preserving code blocks
      preserveReferences: true,      // Default to preserving URLs and file paths
      preserveOpenQuestions: true,   // Default to preserving unanswered questions
      reduceVerbosity: false,        // Default to not reducing verbosity (can be expensive)
      ...strategyOptions             // Override with any provided options
    };
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

    // Create the appropriate strategy via factory using our configured strategy options
    const strategy = SummarizationStrategyFactory.createStrategy(this.strategyOptions);
    this.cachedStrategy = strategy; // Cache for later reference
    
    logStep(`Using summarization strategy: ${strategy.name}`);
    
    // Apply importance scoring if the strategy requires it 
    if (this.strategyOptions.useImportanceScoring) {
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
   * Returns the name of the strategy being used by this history manager
   */
  getStrategyName(): string {
    if (this.cachedStrategy) {
      return this.cachedStrategy.name;
    }
    
    // If we haven't created a strategy yet, create one temporarily to get its name
    const strategy = SummarizationStrategyFactory.createStrategy(this.strategyOptions);
    return strategy.name;
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
  
  /**
   * Updates the strategy options for this history manager
   * @param options New strategy options to use
   */
  setStrategyOptions(options: Partial<StrategyOptions>): void {
    this.strategyOptions = {
      ...this.strategyOptions,
      ...options
    };
    
    // Clear cached strategy since options changed
    this.cachedStrategy = null;
    
    logger.debug(`${agentConfig.logging.historyManager} Updated summarization strategy options: ${JSON.stringify(this.strategyOptions)}`);
  }
  
  /**
   * Creates a comprehensive history manager that uses all preservers
   * to ensure maximum context preservation
   */
  static createComprehensive(): HistoryManager {
    return new HistoryManager({
      preserveCodeBlocks: true,
      preserveReferences: true,
      preserveOpenQuestions: true,
      reduceVerbosity: false
    });
  }
  
  /**
   * Creates a token-optimized history manager that uses all preservers
   * plus verbosity reduction for maximum token efficiency
   */
  static createTokenOptimized(): HistoryManager {
    return new HistoryManager({
      preserveCodeBlocks: true,
      preserveReferences: true,
      preserveOpenQuestions: true,
      reduceVerbosity: true
    });
  }
}
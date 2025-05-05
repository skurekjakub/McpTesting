// filepath: src/server/agent/history-manager-provider.ts
import { Content } from '@google/generative-ai';
import { HistoryManager } from './history-manager';
import { StrategyOptions } from './strategies/strategy-factory';
import { ConversationAnalyzerService } from './conversation-analyzer';
import logger from '../../logger';
import { agentConfig } from '../agent-config';
import { AnalysisOptions } from './types';

/**
 * Provides instances of HistoryManager based on conversation context analysis.
 * This allows dynamically selecting the best summarization strategy and options.
 */
export class HistoryManagerProvider {
  private analyzerService: ConversationAnalyzerService;

  constructor() {
    this.analyzerService = new ConversationAnalyzerService();
    logger.info(`${agentConfig.logging.historyManager} HistoryManagerProvider initialized.`);
  }

  /**
   * Analyzes the conversation history using the configured analyzer strategy
   * and returns appropriate StrategyOptions.
   *
   * @param history The conversation history.
   * @param analysisOptions Optional configuration for the analysis process.
   * @returns StrategyOptions tailored to the history content.
   */
  private async determineStrategyOptions(
    history: Content[],
    analysisOptions?: AnalysisOptions
  ): Promise<Partial<StrategyOptions>> {
    logger.debug(`${agentConfig.logging.historyManager} Determining strategy options based on history analysis...`);
    const analysisResult = await this.analyzerService.analyzeHistory(history, analysisOptions);

    // Default options (can be influenced by global config too)
    const options: Partial<StrategyOptions> = {
      useImportanceScoring: agentConfig.importanceScoring.enabled,
      useCostOptimization: false,
      // Start with defaults based on analysis recommendations or fallbacks
      preserveCodeBlocks: analysisResult.recommendedOptimizations?.preserveCode ?? true,
      preserveReferences: analysisResult.recommendedOptimizations?.preserveReferences ?? true,
      // Map trackOpenQuestions from analysis to preserveOpenQuestions for the strategy
      preserveOpenQuestions: analysisResult.recommendedOptimizations?.trackOpenQuestions ?? true,
      reduceVerbosity: analysisResult.recommendedOptimizations?.reduceVerbosity ?? false,
    };

    // Log the determined options
    logger.debug(`${agentConfig.logging.historyManager} Determined strategy options: ${JSON.stringify(options)}`);
    logger.debug(`${agentConfig.logging.historyManager} Based on analysis pattern: ${analysisResult.conversationPattern || 'N/A'}`);
    if (analysisResult.rawAnalysis) {
        logger.debug(`${agentConfig.logging.historyManager} Raw analysis details: ${analysisResult.rawAnalysis}`);
    }


    return options;
  }

  /**
   * Gets an instance of HistoryManager configured dynamically based on the
   * provided conversation history using the ConversationAnalyzerService.
   *
   * @param history The conversation history.
   * @param analysisOptions Optional configuration for the analysis process.
   * @returns A Promise resolving to a configured HistoryManager instance.
   */
  public async getHistoryManager(
      history: Content[],
      analysisOptions?: AnalysisOptions
    ): Promise<HistoryManager> {
    const strategyOptions = await this.determineStrategyOptions(history, analysisOptions);
    // Pass the determined options to the HistoryManager constructor
    return new HistoryManager(strategyOptions);
  }

  /**
   * Gets a default HistoryManager instance using predefined comprehensive settings.
   * Useful when specific history analysis isn't needed or possible.
   * This bypasses the dynamic analysis.
   */
  public getDefaultComprehensiveManager(): HistoryManager {
     logger.debug(`${agentConfig.logging.historyManager} Providing default comprehensive HistoryManager.`);
    // Use the static method from HistoryManager directly or define options here
    return HistoryManager.createComprehensive();
  }

   /**
   * Gets a default HistoryManager instance using predefined token-optimized settings.
   * Useful when specific history analysis isn't needed or possible.
   * This bypasses the dynamic analysis.
   */
  public getDefaultTokenOptimizedManager(): HistoryManager {
    logger.debug(`${agentConfig.logging.historyManager} Providing default token-optimized HistoryManager.`);
    // Use the static method from HistoryManager directly or define options here
    return HistoryManager.createTokenOptimized();
  }
}

// Export a singleton instance for easy use across the application
export const historyManagerProvider = new HistoryManagerProvider();

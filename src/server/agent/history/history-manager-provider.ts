// src/server/agent/history/history-manager-provider.ts
import { Content } from '@google/generative-ai';
import { HistoryManager } from '../history-manager';
import { ConversationAnalyzerService, AnalysisStrategy } from './conversation-analyzer-service'; // Updated import
import logger from '../../logger';
import { agentConfig } from '../agent-config';

/**
 * Options for configuring the optimal history manager
 */
export interface HistoryManagerOptions {
  tokenLimit?: number;
  costOptimization?: boolean;
  // analysisMethod is removed as the provider now recommends the strategy
}

/**
 * Provider that manages the selection and creation of appropriate
 * history managers based on conversation characteristics.
 */
export class HistoryManagerProvider {
  private static analyzerService = new ConversationAnalyzerService();

  /**
   * Provides an optimally configured history manager based on 
   * conversation characteristics.
   * 
   * @param history The conversation history to analyze
   * @param options Options for the history manager
   * @returns An optimally configured history manager
   */
  static async provideOptimalHistoryManager(
    history: Content[],
    options: HistoryManagerOptions = {}
  ): Promise<HistoryManager> {
    const {
      tokenLimit = agentConfig.summarization.threshold,
      costOptimization = agentConfig.summarization.costOptimizationEnabled,
    } = options;

    try {
      // Recommend the analysis strategy based on heuristics
      const recommendedStrategy = this.analyzerService.recommendStrategy(history);
      logger.debug(`${agentConfig.logging.historyManager} Recommended analysis strategy: ${recommendedStrategy}`);

      // Analyze the conversation using the recommended strategy
      const analysisResult = await this.analyzerService.analyzeConversation(history, recommendedStrategy);
      
      // Log the analysis results for debugging
      logger.debug(`${agentConfig.logging.historyManager} Conversation analysis result:`, { 
        strategyUsed: analysisResult.strategyUsed,
        topics: analysisResult.topics,
        languages: analysisResult.programmingLanguages,
        entities: analysisResult.entities,
        priorityMessages: analysisResult.priorityMessages.length,
        compressibleMessages: analysisResult.compressibleMessages.length,
        processingTimeMs: analysisResult.processingTimeMs
      });

      // Estimate token count (can be refined based on analysis results if needed)
      const estimatedTokenCount = history.reduce((sum, msg) => 
        sum + JSON.stringify(msg).length / 4, // Rough estimation
      0);

      // Create strategy options based on analysis results and config
      const strategyOptions = {
        // Use importance scoring if enabled and there's substantial conversation
        useImportanceScoring: agentConfig.importanceScoring.enabled && 
                              estimatedTokenCount > tokenLimit * 0.5,
        
        // Configure cost optimization
        useCostOptimization: costOptimization,
        
        // Configure feature preservation based on analysis results
        // Check if any code-related languages were detected or topics/entities suggest code
        preserveCodeBlocks: analysisResult.programmingLanguages.length > 0 || 
                            analysisResult.topics.some(t => t.match(/code|script|program|debug/i)) ||
                            analysisResult.entities.some(e => e.match(/\.(js|ts|py|java|cs|cpp|go|rs|rb|php|html|css)/i)),
        preserveReferences: analysisResult.entities.some(e => e.match(/https?:\/\/|\b[a-zA-Z]:\\|\b\//i)), // Basic check for URLs/paths in entities
        preserveOpenQuestions: analysisResult.topics.some(t => t.match(/question|help|how to/i)), // Basic check
        
        // Configure verbosity reduction if approaching token limit
        reduceVerbosity: estimatedTokenCount > tokenLimit * 0.8
      };

      // Create and return the history manager with optimal strategy options
      return new HistoryManager(strategyOptions);

    } catch (error) {
      // Fallback to a safe default in case of errors
      logger.error(`${agentConfig.logging.historyManager} Error determining optimal history manager, using defaults:`, error);
      return new HistoryManager({ // Provide sensible defaults
        preserveCodeBlocks: true,
        preserveReferences: true,
        preserveOpenQuestions: true,
        reduceVerbosity: false,
        useCostOptimization: false,
        useImportanceScoring: agentConfig.importanceScoring.enabled
      });
    }
  }

  /**
   * Provides an optimal history manager synchronously using only
   * lightweight pattern matching (REGEX_BASED analysis).
   * Use this when you need a history manager immediately and can't wait 
   * for async analysis to complete.
   * 
   * @param history The conversation history to analyze
   * @param options Options for the history manager
   * @returns A reasonably configured history manager
   */
  static provideOptimalHistoryManagerSync(
    history: Content[],
    options: HistoryManagerOptions = {}
  ): HistoryManager {
    const {
      tokenLimit = agentConfig.summarization.threshold,
      costOptimization = agentConfig.summarization.costOptimizationEnabled
    } = options;

    try {
      // Use synchronous REGEX_BASED analysis (implicitly via performRegexBasedAnalysis)
      // Note: analyzeConversation is async, so we can't directly call it here.
      // We'll simulate the outcome of REGEX_BASED analysis for options.
      
      // Perform minimal heuristic check for sync options
      let containsCode = false;
      let containsReferences = false;
      let estimatedTokenCount = 0;
      const text = history.slice(-5).map(msg => JSON.stringify(msg)).join(' '); // Quick check on recent text
      estimatedTokenCount = text.length / 4;
      if (text.includes('```') || text.match(/\.(js|ts|py|java|cs)/i)) containsCode = true;
      if (text.includes('http') || text.match(/[a-zA-Z]:\\|\b\//)) containsReferences = true;

      const strategyOptions = {
        useImportanceScoring: agentConfig.importanceScoring.enabled, // Can still be enabled
        useCostOptimization: costOptimization,
        preserveCodeBlocks: containsCode, // Based on quick check
        preserveReferences: containsReferences, // Based on quick check
        preserveOpenQuestions: true, // Default to true for safety in sync mode
        reduceVerbosity: estimatedTokenCount > tokenLimit * 0.8
      };

      return new HistoryManager(strategyOptions);

    } catch (error) {
      // Fallback to safe defaults in case of error
      logger.error(`${agentConfig.logging.historyManager} Error determining optimal history manager synchronously, using defaults:`, error);
      return new HistoryManager({ // Provide sensible defaults
        preserveCodeBlocks: true,
        preserveReferences: true,
        preserveOpenQuestions: true,
        reduceVerbosity: false,
        useCostOptimization: false,
        useImportanceScoring: agentConfig.importanceScoring.enabled
      });
    }
  }

  /**
   * Creates a history manager that is optimized for code-heavy conversations.
   * This is useful when you know in advance that the conversation will focus on code.
   */
  static createCodeFocusedHistoryManager(options: HistoryManagerOptions = {}): HistoryManager {
    const { costOptimization = false } = options;
    
    return new HistoryManager({
      preserveCodeBlocks: true,
      preserveReferences: true,
      preserveOpenQuestions: true,
      reduceVerbosity: costOptimization,
      useCostOptimization: costOptimization
    });
  }

  /**
   * Creates a history manager that is optimized for research-focused conversations
   * with many references that should be preserved.
   */
  static createResearchFocusedHistoryManager(options: HistoryManagerOptions = {}): HistoryManager {
    const { costOptimization = false } = options;
    
    return new HistoryManager({
      preserveCodeBlocks: false,
      preserveReferences: true,
      preserveOpenQuestions: true,
      reduceVerbosity: costOptimization,
      useCostOptimization: costOptimization
    });
  }

  /**
   * Creates a history manager that is optimized for very long conversations
   * where cost optimization and token reduction are critical.
   */
  static createTokenOptimizedHistoryManager(): HistoryManager {
    return new HistoryManager({
      preserveCodeBlocks: true,
      preserveReferences: true,
      preserveOpenQuestions: true,
      reduceVerbosity: true,
      useCostOptimization: true
    });
  }
}
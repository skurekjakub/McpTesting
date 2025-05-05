import { Content } from '@google/generative-ai';
import { ConversationAnalyzerFactory } from './analysis/analyzer-factory';
import { AnalysisOptions, ConversationAnalysisResult, IConversationAnalyzerStrategy } from './types';
import { agentConfig } from '../agent-config';
import logger from '../../logger';

/**
 * Service responsible for analyzing conversation history using a configured strategy.
 */
export class ConversationAnalyzerService {
  private strategy: IConversationAnalyzerStrategy;

  constructor() {
    this.strategy = ConversationAnalyzerFactory.createAnalyzer();
  }

  /**
   * Analyzes the conversation history using the configured strategy.
   *
   * @param history The conversation history.
   * @param options Optional analysis configuration.
   * @returns A promise resolving to the ConversationAnalysisResult.
   */
  async analyzeHistory(
    history: Content[],
    options?: AnalysisOptions
  ): Promise<Partial<ConversationAnalysisResult>> {
     logger.debug(`${agentConfig.logging.historyManager} Starting conversation analysis...`);
    try {
      const result = await this.strategy.analyze(history, options);
      // Potentially merge results if multiple strategies were used in the future
      return result;
    } catch (error) {
      logger.error(`${agentConfig.logging.historyManager} Error during conversation analysis:`, error);
      // Return a default/empty result on error to avoid breaking flow
      return {
         recommendedOptimizations: { // Provide safe defaults
             preserveCode: true,
             preserveReferences: true,
             trackOpenQuestions: true,
             reduceVerbosity: false,
         }
      };
    }
  }
}
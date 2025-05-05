import { IConversationAnalyzerStrategy } from '../types';
import { RegexAnalyzerStrategy } from './regex-analyzer';
import { SemanticAnalyzerStrategy } from './semantic-analyzer';
import { agentConfig } from '../../agent-config';
import logger from '../../../logger';

export class ConversationAnalyzerFactory {
  static createAnalyzer(): IConversationAnalyzerStrategy {
    const strategyName = agentConfig.analysis.analyzerStrategy;
    logger.info(`${agentConfig.logging.historyManager} Creating conversation analyzer strategy: ${strategyName}`);

    switch (strategyName?.toLowerCase()) {
      case 'semantic':
        // Note: Currently a placeholder implementation
        return new SemanticAnalyzerStrategy();
      case 'regex':
      default:
        if (strategyName?.toLowerCase() !== 'regex') {
           logger.warn(`${agentConfig.logging.historyManager} Unknown analyzer strategy '${strategyName}'. Defaulting to 'regex'.`);
        }
        return new RegexAnalyzerStrategy();
    }
  }
}
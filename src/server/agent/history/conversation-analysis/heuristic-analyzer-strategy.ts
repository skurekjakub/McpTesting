// src/server/agent/history/heuristic-analyzer-strategy.ts
import { Content } from '@google/generative-ai';
import { MessageUtils } from './message-utils';
import { 
  AnalysisOptions, 
  ConversationAnalysisResult, 
  IConversationAnalyzerStrategy 
} from './types';

/**
 * Implements conversation analysis using heuristic-based methods.
 * This is faster but less nuanced than LLM analysis.
 */
export class HeuristicAnalyzerStrategy implements IConversationAnalyzerStrategy {
  async analyze(
    history: Content[], 
    options?: AnalysisOptions
  ): Promise<Partial<ConversationAnalysisResult>> {
    const maxMessages = options?.maxMessagesToAnalyze ?? 10;
    
    // Limit to recent messages for analysis
    const recentHistory = history.slice(-maxMessages);
    
    // Initialize counters
    let codeBlockCount = 0;
    let urlCount = 0;
    let filePathCount = 0;
    let totalLength = 0;
    
    // Regex patterns
    const codeBlockPattern = /```[\s\S]*?```/g;
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    const filePathPattern = /(?:[a-zA-Z]:\\[\w\-.\\]+)|(?:\/[\w\-./]+\.\w+)/g;
    
    // Questions tracking
    const userMessages = recentHistory.filter(msg => msg.role === 'user');
    const openQuestionRE = /([^.!?]+\?)\s/g;
    let questionMatches: RegExpExecArray | null;
    let questionCount = 0;
    
    // Process each message
    for (const message of recentHistory) {
      const text = MessageUtils.getTextContent(message);
      totalLength += text.length;
      
      // Count code blocks
      const codeMatches = text.match(codeBlockPattern);
      if (codeMatches) codeBlockCount += codeMatches.length;
      
      // Count URLs and file paths
      const urlMatches = text.match(urlPattern);
      if (urlMatches) urlCount += urlMatches.length;
      
      const filePathMatches = text.match(filePathPattern);
      if (filePathMatches) filePathCount += filePathMatches.length;
      
      // Count questions (rough heuristic)
      if (message.role === 'user') {
        while ((questionMatches = openQuestionRE.exec(text)) !== null) {
          questionCount++;
        }
      }
    }
    
    // Calculate averages
    const averageMessageLength = totalLength / (recentHistory.length || 1);
    
    // Return analysis result
    return {
      codeBlockCount,
      containsCodeSnippets: codeBlockCount > 0,
      urlCount, 
      filePathCount,
      containsReferences: urlCount + filePathCount > 0,
      openQuestionCount: questionCount, // Simplified; we're not tracking answered vs. unanswered
      answeredQuestionCount: 0, // Would require more sophisticated analysis
      hasOpenQuestions: questionCount > 0,
      averageMessageLength,
      isVerbose: averageMessageLength > 500,
      hasTechnicalContent: codeBlockCount > 0 || filePathCount > 0
    };
  }
}

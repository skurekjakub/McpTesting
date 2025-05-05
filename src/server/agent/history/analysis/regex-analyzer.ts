import { Content } from '@google/generative-ai';
import { MessageUtils } from '../message-utils';
import {
  AnalysisOptions,
  ConversationAnalysisResult,
  ConversationPattern,
  IConversationAnalyzerStrategy,
} from '../types';
import logger from '../../../logger';
import { agentConfig } from '../../agent-config';

/**
 * Analyzes conversation history using simple regex patterns to detect
 * code blocks, references (URLs/paths), and open questions.
 */
export class RegexAnalyzerStrategy implements IConversationAnalyzerStrategy {
  async analyze(
    history: Content[],
    options?: AnalysisOptions
  ): Promise<Partial<ConversationAnalysisResult>> {
    logger.debug(`${agentConfig.logging.historyManager} Running Regex Conversation Analyzer...`);

    let codeBlockCount = 0;
    let urlCount = 0;
    let filePathCount = 0;
    let openQuestionCount = 0;

    const historyToAnalyze = options?.maxMessagesToAnalyze
      ? history.slice(-options.maxMessagesToAnalyze)
      : history;

    for (const message of historyToAnalyze) {
      const textContent = MessageUtils.getTextContent(message);
      if (!textContent) continue;

      // Basic code block check (markdown)
      if (textContent.includes('```')) {
        codeBlockCount++;
      }

      // Basic URL check
      urlCount += (textContent.match(/\bhttps?:\/\/\S+/gi) || []).length;

      // Basic file path check (Unix-like and Windows-like) - very simplified
      filePathCount += (textContent.match(/(\/[^\/\s\n]+|[a-zA-Z]:\\[^\/\s\n]+)/g) || []).length;


      // Check for open questions in user messages
      if (message.role === 'user' && textContent.trim().endsWith('?')) {
        openQuestionCount++;
        // TODO: Could add logic to check if the *next* model message seems to answer it
      }
    }

    const hasCode = codeBlockCount > 0;
    const hasReferences = urlCount > 0 || filePathCount > 0;
    const hasOpenQuestions = openQuestionCount > 0;

    // Determine a simple pattern
    let pattern = ConversationPattern.GENERAL_CHAT;
    if (hasCode && codeBlockCount > 2) { // Arbitrary threshold
        pattern = ConversationPattern.CODE_DEVELOPMENT;
    } else if (hasOpenQuestions && openQuestionCount > historyToAnalyze.length / 4) { // If many questions
        pattern = ConversationPattern.QUESTION_ANSWERING;
    } else if (hasReferences && urlCount + filePathCount > 2) {
        pattern = ConversationPattern.RESEARCH_FOCUSED;
    }

    const result: Partial<ConversationAnalysisResult> = {
      hasTechnicalContent: hasCode,
      codeBlockCount: codeBlockCount,
      containsCodeSnippets: hasCode, // Simple assumption for regex analyzer
      urlCount: urlCount,
      filePathCount: filePathCount,
      containsReferences: hasReferences,
      openQuestionCount: openQuestionCount,
      // answeredQuestionCount: 0, // Harder to determine with regex
      hasOpenQuestions: hasOpenQuestions,
      conversationPattern: pattern,
      recommendedOptimizations: {
        preserveCode: hasCode,
        preserveReferences: hasReferences,
        trackOpenQuestions: hasOpenQuestions, // Map this to preserveOpenQuestions later
        reduceVerbosity: false, // Default for regex, could be set based on length/turns
      },
      rawAnalysis: `Regex Analysis: CodeBlocks=${codeBlockCount}, URLs=${urlCount}, Paths=${filePathCount}, Questions=${openQuestionCount}`,
    };

    logger.debug(`${agentConfig.logging.historyManager} Regex Analysis Result: ${JSON.stringify(result.recommendedOptimizations)}`);
    return result;
  }
}
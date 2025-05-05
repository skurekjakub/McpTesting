// src/server/agent/history/strategies/decorators/open-question-preserving-decorator.ts
import { Content } from '@google/generative-ai';
import { StrategySummarizationDecorator } from './base-decorator';
import { MessageUtils } from '../../message-utils';
import logger from '../../../../logger';

interface Question {
  id: string;
  text: string;
  messageIndex: number;
  answered: boolean;
}

/**
 * A decorator that identifies and preserves unanswered user questions during summarization.
 * This ensures that pending questions aren't lost during the summarization process.
 */
export class OpenQuestionPreservingDecorator extends StrategySummarizationDecorator {
  protected getDecoratorName(): string {
    return 'open-question-preserving';
  }
  
  protected getDecoratorDescription(): string {
    return 'Preserves unanswered questions during summarization';
  }
  
  async summarize(history: Content[]): Promise<Content[]> {
    // Extract questions and mark which ones appear to be answered
    const questions = this.identifyQuestions(history);
    
    // Find unanswered questions that need preservation
    const unansweredQuestions = questions.filter(q => !q.answered);
    
    if (unansweredQuestions.length === 0) {
      logger.debug(`[${this.getDecoratorName()}] No unanswered questions found, proceeding with regular summarization`);
      return this.baseStrategy.summarize(history);
    }
    
    logger.debug(`[${this.getDecoratorName()}] Found ${unansweredQuestions.length} unanswered questions to preserve`);
    
    // Mark the messages containing unanswered questions as high importance
    // We'll do this by adding metadata to help other components (like ImportanceScorer) recognize them
    const markedHistory = this.markUnansweredQuestionsAsImportant(history, unansweredQuestions);
    
    // Apply the base strategy to get summarized history
    const summarizedHistory = await this.baseStrategy.summarize(markedHistory);
    
    // Check if unanswered questions are preserved in the summarized history
    const preservedQuestions = this.checkPreservedQuestions(summarizedHistory, unansweredQuestions);
    
    // If some questions were lost in summarization, add them back
    if (preservedQuestions.length < unansweredQuestions.length) {
      logger.debug(`[${this.getDecoratorName()}] Some unanswered questions (${unansweredQuestions.length - preservedQuestions.length}) were lost in summarization, adding them back`);
      return this.addMissingUnansweredQuestions(summarizedHistory, unansweredQuestions, preservedQuestions);
    }
    
    return summarizedHistory;
  }
  
  /**
   * Identifies all questions in the history and marks which ones appear to have been answered.
   */
  private identifyQuestions(history: Content[]): Question[] {
    const questions: Question[] = [];
    
    // First pass: identify all questions from user messages
    for (let i = 0; i < history.length; i++) {
      const message = history[i];
      
      // Only look for questions in user messages
      if (message.role !== 'user') continue;
      
      const text = MessageUtils.getTextContent(message);
      
      // Find questions (sentences ending with question marks)
      // This regex finds sentences that end with a question mark
      const questionRegex = /[^.!?]*\?/g;
      let questionMatch: RegExpExecArray | null;
      
      while ((questionMatch = questionRegex.exec(text)) !== null) {
        const questionText = questionMatch[0].trim();
        
        // Skip very short questions or statements that happen to have a question mark
        if (questionText.length < 10) continue;
        
        questions.push({
          id: `QUESTION_${questions.length}_${Date.now()}`,
          text: questionText,
          messageIndex: i,
          answered: false // Initially mark as unanswered
        });
      }
    }
    
    // Second pass: determine which questions have been answered
    // A question is considered answered if there's at least one model response after it
    questions.forEach(question => {
      for (let i = question.messageIndex + 1; i < history.length; i++) {
        if (history[i].role === 'model') {
          // For simplicity, we consider a question answered if there's a model response after it
          // A more sophisticated implementation could check if the response actually addresses the question
          question.answered = true;
          break;
        }
      }
    });
    
    return questions;
  }
  
  /**
   * Marks messages containing unanswered questions as important for preservation.
   */
  private markUnansweredQuestionsAsImportant(history: Content[], unansweredQuestions: Question[]): Content[] {
    // Create a copy of the history so we don't mutate the original
    const markedHistory = history.map((message, index) => {
      // Check if this message contains any unanswered questions
      const containsUnansweredQuestion = unansweredQuestions.some(q => q.messageIndex === index);
      
      if (containsUnansweredQuestion) {
        // Add metadata to indicate this message is important - this helps if we're using the importance scorer
        return {
          ...message,
          parts: [...message.parts],
          importanceScore: 1.0, // Highest importance score to ensure preservation
          metadata: { containsUnansweredQuestion: true }
        };
      }
      
      return message;
    });
    
    return markedHistory;
  }
  
  /**
   * Checks if unanswered questions are preserved in the summarized history.
   */
  private checkPreservedQuestions(summarizedHistory: Content[], unansweredQuestions: Question[]): Question[] {
    const preservedQuestions = [];
    
    for (const question of unansweredQuestions) {
      let isPreserved = false;
      
      // Check each message to see if it contains the question text
      for (const message of summarizedHistory) {
        const messageText = MessageUtils.getTextContent(message);
        
        if (messageText.includes(question.text)) {
          isPreserved = true;
          break;
        }
      }
      
      if (isPreserved) {
        preservedQuestions.push(question);
      }
    }
    
    return preservedQuestions;
  }
  
  /**
   * Adds any missing unanswered questions back into the summarized history.
   */
  private addMissingUnansweredQuestions(
    summarizedHistory: Content[], 
    allUnansweredQuestions: Question[], 
    preservedQuestions: Question[]
  ): Content[] {
    // Find questions that weren't preserved
    const missingQuestions = allUnansweredQuestions.filter(
      q => !preservedQuestions.some(pq => pq.id === q.id)
    );
    
    if (missingQuestions.length === 0) {
      return summarizedHistory;
    }
    
    // Group questions by their original messages
    const questionsByMessageIndex = missingQuestions.reduce((acc, question) => {
      if (!acc[question.messageIndex]) {
        acc[question.messageIndex] = [];
      }
      acc[question.messageIndex].push(question);
      return acc;
    }, {} as Record<number, Question[]>);
    
    // Create a special note with the missing questions
    const pendingQuestionsMessage: Content = {
      role: 'model',
      parts: [{ 
        text: `PENDING QUESTIONS (preserved from earlier conversation):\n${
          missingQuestions.map((q, idx) => `${idx + 1}. ${q.text}`).join('\n')
        }`
      }]
    };
    
    // Add the pending questions message at an appropriate location
    // If there's a summary message, add it right after; otherwise add to the beginning
    const summaryMessageIndex = summarizedHistory.findIndex(
      msg => MessageUtils.getTextContent(msg).includes('CONVERSATION SUMMARY')
    );
    
    if (summaryMessageIndex >= 0) {
      return [
        ...summarizedHistory.slice(0, summaryMessageIndex + 1),
        pendingQuestionsMessage,
        ...summarizedHistory.slice(summaryMessageIndex + 1)
      ];
    } else {
      // If no summary message, add to the beginning
      return [pendingQuestionsMessage, ...summarizedHistory];
    }
  }
}
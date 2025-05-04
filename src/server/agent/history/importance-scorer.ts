// src/server/agent/history/importance-scorer.ts
import { Content } from '@google/generative-ai';
import logger from '../../logger';
import { agentConfig } from '../agent-config';
import { ScoredMessage } from './types';
import { MessageUtils } from './message-utils';

/**
 * Service responsible for scoring message importance based on contextual factors.
 * Applies multiple scoring strategies and weights to identify key messages.
 */
export class ImportanceScorer {
  /**
   * Scores each message in the history based on contextual importance factors
   * and adds an importanceScore property for use in summarization decisions.
   * 
   * @param history The conversation history to score
   * @returns The same history with importance scores attached
   */
  scoreHistoryImportance(history: Content[]): ScoredMessage[] {
    const scoredHistory = [...history] as ScoredMessage[];
    
    // Calculate importance scores
    for (let i = 0; i < scoredHistory.length; i++) {
      const message = scoredHistory[i];
      
      // Calculate various component scores
      const keywordScore = this.calculateKeywordImportance(message);
      const recencyScore = this.calculateRecencyImportance(i, scoredHistory.length);
      const lengthScore = this.calculateLengthImportance(message);
      const responseScore = this.calculateResponseInfluence(i, scoredHistory);
      
      // Apply weights and calculate total score
      const totalScore = (
        keywordScore * agentConfig.importanceScoring.keywordImportanceWeight +
        recencyScore * agentConfig.importanceScoring.recencyImportanceWeight +
        lengthScore * agentConfig.importanceScoring.lengthImportanceWeight +
        responseScore * agentConfig.importanceScoring.responseImportanceWeight
      );
      
      // Attach the score to the message
      scoredHistory[i].importanceScore = totalScore;
      
      // Log highly important messages for debugging
      if (totalScore > agentConfig.importanceScoring.minImportanceScoreToPreserve) {
        logger.debug(`${agentConfig.logging.historyManager} High importance message (${totalScore.toFixed(2)}) at index ${i}: "${MessageUtils.getTextPreview(message)}"`);
      }
    }
    
    return scoredHistory;
  }
  
  /**
   * Calculates a score based on the presence of important keywords in the message
   */
  private calculateKeywordImportance(message: Content): number {
    const text = MessageUtils.getTextContent(message).toLowerCase();
    
    // Count occurrences of important keywords
    const importantKeywords = agentConfig.importanceScoring.importantKeywords;
    let keywordMatches = 0;
    
    for (const keyword of importantKeywords) {
      if (text.includes(keyword.toLowerCase())) {
        keywordMatches++;
      }
    }
    
    // Normalize score between 0 and 1, with diminishing returns for many matches
    return Math.min(1.0, keywordMatches / 5);
  }
  
  /**
   * Calculates a score based on the position of the message in the history
   * with more recent messages getting higher scores
   */
  private calculateRecencyImportance(index: number, totalMessages: number): number {
    if (totalMessages <= 1) return 1.0;
    
    // Linear recency score - more recent messages get higher scores
    return index / (totalMessages - 1);
  }
  
  /**
   * Calculates a score based on message length and complexity
   * with longer, more substantive messages getting higher scores
   */
  private calculateLengthImportance(message: Content): number {
    const text = MessageUtils.getTextContent(message);
    const charCount = text.length;
    
    // Normalize based on character count with diminishing returns for very long messages
    // Score increases up to about 1000 chars then plateaus
    return Math.min(1.0, charCount / 1000);
  }
  
  /**
   * Calculates a score based on whether this message appeared to generate a response
   * User messages that have model responses are considered more important
   */
  private calculateResponseInfluence(index: number, history: Content[]): number {
    const message = history[index];
    const nextMessage = index < history.length - 1 ? history[index + 1] : null;
    
    // User messages that triggered model responses are considered important
    if (message.role === 'user' && nextMessage?.role === 'model') {
      return 1.0;
    }
    
    // Model messages that respond to user queries are also somewhat important
    if (message.role === 'model' && index > 0 && history[index - 1].role === 'user') {
      return 0.7;
    }
    
    return 0.0;
  }
}
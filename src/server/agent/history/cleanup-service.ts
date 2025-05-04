// src/server/agent/history/cleanup-service.ts
import { Content } from '@google/generative-ai';
import logger from '../../logger';
import { agentConfig } from '../agent-config';
import { MessageUtils } from './message-utils';

/**
 * Service for cleaning up history by removing duplicate or unnecessary messages
 */
export class HistoryCleanupService {
  /**
   * Check if the last two messages in history are duplicated model responses.
   * If so, remove the last message to avoid redundancy.
   * 
   * @param history The conversation history to clean
   * @returns Cleaned history with any duplicates removed
   */
  cleanupDuplicateResponses(history: Content[]): Content[] {
    if (history.length < 2) return history;
    
    const last = history[history.length - 1];
    const secondLast = history[history.length - 2];
    
    // Check if both are model messages with identical text content
    if (
      last.role === 'model' &&
      secondLast.role === 'model' &&
      MessageUtils.messagesHaveSameContent(last, secondLast)
    ) {
      logger.warn(`${agentConfig.logging.historyManager} Removing duplicate model message from end of history.`);
      return history.slice(0, history.length - 1);
    }
    
    return history;
  }
  
  /**
   * Removes empty messages from the history
   * 
   * @param history The conversation history to clean
   * @returns Cleaned history with empty messages removed
   */
  removeEmptyMessages(history: Content[]): Content[] {
    return history.filter(msg => {
      const text = MessageUtils.getTextContent(msg);
      return text.trim().length > 0;
    });
  }
}
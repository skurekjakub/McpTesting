// src/server/agent/history/message-utils.ts
import { Content } from '@google/generative-ai';

/**
 * Utility service for message content operations
 */
export class MessageUtils {
  /**
   * Extracts text content from a Content object
   */
  static getTextContent(content: Content): string {
    return content.parts
      .map(part => typeof part === 'object' && 'text' in part ? part.text : '')
      .join('');
  }
  
  /**
   * Gets a preview of message text for logging purposes
   */
  static getTextPreview(content: Content, maxLength: number = 50): string {
    const text = MessageUtils.getTextContent(content);
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }
  
  /**
   * Creates a new user message Content object
   */
  static createUserMessage(text: string): Content {
    return {
      role: 'user',
      parts: [{ text }]
    };
  }
  
  /**
   * Creates a new model/assistant message Content object
   */
  static createModelMessage(text: string): Content {
    return {
      role: 'model',
      parts: [{ text }]
    };
  }
  
  /**
   * Check if two messages have identical content
   */
  static messagesHaveSameContent(message1: Content, message2: Content): boolean {
    return MessageUtils.getTextContent(message1) === MessageUtils.getTextContent(message2);
  }
}
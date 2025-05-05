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
  
  /**
   * Sanitizes a Content object or array by ensuring only standard Content properties are included
   * Removes any additional properties like importanceScore that might cause API validation issues
   * 
   * @param content A single Content object or an array of Content objects
   * @returns A clean copy with only standard API-compatible properties
   */
  static sanitizeContent<T extends Content | Content[]>(content: T): T {
    if (Array.isArray(content)) {
      // For arrays, sanitize each item
      return content.map(item => ({
        role: item.role,
        parts: item.parts.map(part => ({ ...part }))
      })) as T;
    } else {
      // For single items
      return {
        role: content.role,
        parts: content.parts.map(part => ({ ...part }))
      } as T;
    }
  }
}
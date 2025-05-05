// src/server/agent/history/strategies/decorators/verbosity-reducing-decorator.ts
import { Content } from '@google/generative-ai';
import { StrategySummarizationDecorator } from './base-decorator';
import { MessageUtils } from '../../message-utils';
import logger from '../../../../logger';
import { getGeminiClient } from '../../../../llm/gemini/client';
import { extractTextFromResult } from '../../../../llm/gemini/parsing';

/**
 * A decorator that identifies and further compresses verbose passages in the history
 * to optimize token usage while preserving essential information.
 */
export class VerbosityReducingDecorator extends StrategySummarizationDecorator {
  // Configuration
  private readonly verbosityThreshold = 200; // Characters in a message considered verbose
  private readonly verbosityMessageThreshold = 5; // Number of verbose messages before applying additional compression
  private readonly compressionTargetRatio = 0.5; // Target to reduce verbose passages by 50%
  
  protected getDecoratorName(): string {
    return 'verbosity-reducing';
  }
  
  protected getDecoratorDescription(): string {
    return 'Reduces verbosity in lengthy passages to optimize token usage';
  }
  
  async summarize(history: Content[]): Promise<Content[]> {
    // First, let the base strategy do its work
    const baseProcessedHistory = await this.baseStrategy.summarize(history);
    
    // Now, check if there are still verbose passages that could be compressed further
    const verboseMessages = this.identifyVerboseMessages(baseProcessedHistory);
    
    // If there aren't enough verbose messages to warrant additional compression, return the base processed history
    if (verboseMessages.length < this.verbosityMessageThreshold) {
      logger.debug(`[${this.getDecoratorName()}] Only ${verboseMessages.length} verbose messages found, no additional compression needed`);
      return baseProcessedHistory;
    }
    
    logger.debug(`[${this.getDecoratorName()}] Found ${verboseMessages.length} verbose messages, applying additional compression`);
    
    // Apply additional compression to verbose messages
    return this.compressVerboseMessages(baseProcessedHistory, verboseMessages);
  }
  
  /**
   * Identifies messages that are excessively verbose and could benefit from additional compression.
   */
  private identifyVerboseMessages(history: Content[]): { index: number; length: number }[] {
    const verboseMessages: { index: number; length: number }[] = [];
    
    history.forEach((message, index) => {
      // Skip summary messages - they've already been optimized
      const text = MessageUtils.getTextContent(message);
      if (text.includes('CONVERSATION SUMMARY')) {
        return;
      }
      
      // Calculate verbosity metrics
      const length = text.length;
      const sentenceCount = (text.match(/[.!?]+\s/g) || []).length + 1;
      const averageSentenceLength = length / (sentenceCount || 1);
      
      // Apply rules to identify verbose messages
      // We consider a message verbose if it's long AND has high average sentence length
      if (length > this.verbosityThreshold && averageSentenceLength > 20) {
        verboseMessages.push({ index, length });
      }
    });
    
    // Sort by length descending (process longest messages first)
    return verboseMessages.sort((a, b) => b.length - a.length);
  }
  
  /**
   * Compresses verbose messages to reduce token usage while preserving meaning.
   */
  private async compressVerboseMessages(
    history: Content[], 
    verboseMessages: { index: number; length: number }[]
  ): Promise<Content[]> {
    // Create a copy of history to avoid mutating original
    const compressedHistory = [...history];
    
    // Process each verbose message (up to a reasonable limit to avoid too many API calls)
    const processLimit = Math.min(verboseMessages.length, 5);
    
    for (let i = 0; i < processLimit; i++) {
      const { index, length } = verboseMessages[i];
      const message = history[index];
      const text = MessageUtils.getTextContent(message);
      
      // Skip if message is already short enough after rechecking
      if (text.length <= this.verbosityThreshold) {
        continue;
      }
      
      try {
        // Use LLM to compress the verbose message
        const compressedText = await this.compressText(text);
        
        if (compressedText && compressedText.length < text.length * 0.9) { // Only use if it actually reduced size by at least 10%
          // Create a copy of the message with compressed text
          const compressedMessage = {
            ...message,
            parts: message.parts.map(part => 
              typeof part === 'object' && 'text' in part ? { text: compressedText } : part
            )
          };
          
          compressedHistory[index] = compressedMessage;
          
          const compressionRatio = compressedText.length / text.length;
          logger.debug(`[${this.getDecoratorName()}] Compressed message at index ${index} (${text.length} → ${compressedText.length} chars, ratio: ${compressionRatio.toFixed(2)})`);
        }
      } catch (error) {
        logger.warn(`[${this.getDecoratorName()}] Error compressing verbose message: ${error}`);
      }
    }
    
    return compressedHistory;
  }
  
  /**
   * Uses an LLM to compress text while preserving its meaning.
   */
  private async compressText(text: string): Promise<string> {
    try {
      const client = getGeminiClient();
      const model = client.getGenerativeModel({ 
        model: "gemini-2.0-flash",
        generationConfig: { temperature: 0.2 } // Use low temperature for more concise output
      });
      
      const promptText = `Please rewrite the following text to be much more concise while preserving all important information, technical details, key points, and examples. Aim to reduce the length by about 50% by eliminating redundancy, wordiness, and unnecessary elaboration. Keep all factual content and technical accuracy.

Text to condense:
"${text}"`;

      const result = await model.generateContent({ 
        contents: [{ role: 'user', parts: [{ text: promptText }] }]
      });
      
      const compressedText = extractTextFromResult(result);
      
      // Fallback to original if something went wrong
      return compressedText || text;
    } catch (error) {
      logger.error(`[${this.getDecoratorName()}] Error in text compression: ${error}`);
      return text; // Return original text on error
    }
  }
}
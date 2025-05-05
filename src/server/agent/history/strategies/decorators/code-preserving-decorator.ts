// src/server/agent/history/strategies/decorators/code-preserving-decorator.ts
import { Content } from '@google/generative-ai';
import { StrategySummarizationDecorator } from './base-decorator';
import { MessageUtils } from '../../message-utils';
import logger from '../../../../logger';

/**
 * A decorator that preserves code blocks during summarization.
 * This ensures that important code snippets are not lost or mangled
 * during the summarization process.
 */
export class CodePreservingDecorator extends StrategySummarizationDecorator {
  protected getDecoratorName(): string {
    return 'code-preserving';
  }
  
  protected getDecoratorDescription(): string {
    return 'Preserves code blocks during summarization';
  }
  
  async summarize(history: Content[]): Promise<Content[]> {
    // Extract code blocks from content
    const { historyWithMarkers, extractedCodeBlocks } = this.extractCodeBlocks(history);
    
    logger.debug(`[${this.getDecoratorName()}] Extracted ${extractedCodeBlocks.length} code blocks before summarization`);
    
    // Apply the base strategy to the history with code blocks replaced by markers
    const summarizedHistory = await this.baseStrategy.summarize(historyWithMarkers);
    
    // Reinsert the preserved code blocks
    const finalHistory = this.reinsertCodeBlocks(summarizedHistory, extractedCodeBlocks);
    
    return finalHistory;
  }
  
  /**
   * Extracts code blocks from the history and replaces them with marker placeholders.
   */
  private extractCodeBlocks(history: Content[]): { 
    historyWithMarkers: Content[], 
    extractedCodeBlocks: Array<{ id: string, code: string }> 
  } {
    const extractedCodeBlocks: Array<{ id: string, code: string }> = [];
    const historyWithMarkers = history.map(message => {
      const text = MessageUtils.getTextContent(message);
      
      // Create a copy of the message to avoid mutating the original
      const newMessage = { ...message, parts: [...message.parts] };
      
      // Try to find code blocks (marked with triple backticks)
      const codeBlockRegex = /```(?:[a-zA-Z0-9]*)\n?([\s\S]*?)```/g;
      let match: RegExpExecArray | null;
      let modifiedText = text;
      
      // For each code block found
      while ((match = codeBlockRegex.exec(text)) !== null) {
        const fullMatch = match[0]; // The entire code block including backticks
        const codeContent = match[1]; // Just the code itself
        
        // Generate a unique ID for this code block
        const codeBlockId = `CODE_BLOCK_${extractedCodeBlocks.length}_${Date.now()}`;
        
        // Store the extracted code block
        extractedCodeBlocks.push({
          id: codeBlockId,
          code: fullMatch
        });
        
        // Replace the code block with a marker
        modifiedText = modifiedText.replace(fullMatch, `[${codeBlockId}]`);
      }
      
      // Only update the message if we found and replaced code blocks
      if (modifiedText !== text) {
        newMessage.parts = newMessage.parts.map(part => 
          typeof part === 'object' && 'text' in part ? { text: modifiedText } : part
        );
      }
      
      return newMessage;
    });
    
    return { historyWithMarkers, extractedCodeBlocks };
  }
  
  /**
   * Reinserts preserved code blocks back into the summarized history.
   */
  private reinsertCodeBlocks(history: Content[], codeBlocks: Array<{ id: string, code: string }>): Content[] {
    if (codeBlocks.length === 0) {
      return history; // No code blocks to reinsert
    }
    
    return history.map(message => {
      const text = MessageUtils.getTextContent(message);
      
      // Create a copy of the message to avoid mutating the original
      const newMessage = { ...message, parts: [...message.parts] };
      
      // Try to find markers for code blocks
      let modifiedText = text;
      
      // For each code block, check if its marker exists in this message
      for (const { id, code } of codeBlocks) {
        const markerRegex = new RegExp(`\\[${id}\\]`, 'g');
        if (markerRegex.test(modifiedText)) {
          // Replace the marker with the original code block
          modifiedText = modifiedText.replace(markerRegex, code);
        }
      }
      
      // Only update the message if we replaced any markers
      if (modifiedText !== text) {
        newMessage.parts = newMessage.parts.map(part => 
          typeof part === 'object' && 'text' in part ? { text: modifiedText } : part
        );
      }
      
      return newMessage;
    });
  }
}
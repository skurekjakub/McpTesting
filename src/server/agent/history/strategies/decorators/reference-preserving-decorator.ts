// src/server/agent/history/strategies/decorators/reference-preserving-decorator.ts
import { Content } from '@google/generative-ai';
import { StrategySummarizationDecorator } from './base-decorator';
import { MessageUtils } from '../../message-utils';
import logger from '../../../../logger';

/**
 * A decorator that preserves references such as URLs, file paths, and citations during summarization.
 * This ensures that important links and sources are not lost in the summary process.
 */
export class ReferencePreservingDecorator extends StrategySummarizationDecorator {
  protected getDecoratorName(): string {
    return 'reference-preserving';
  }
  
  protected getDecoratorDescription(): string {
    return 'Preserves URLs, file paths, and citations during summarization';
  }
  
  async summarize(history: Content[]): Promise<Content[]> {
    // Extract references from content
    const { historyWithMarkers, extractedReferences } = this.extractReferences(history);
    
    logger.debug(`[${this.getDecoratorName()}] Extracted ${extractedReferences.length} references before summarization`);
    
    // Apply the base strategy to the history with references replaced by markers
    const summarizedHistory = await this.baseStrategy.summarize(historyWithMarkers);
    
    // Reinsert the preserved references
    const finalHistory = this.reinsertReferences(summarizedHistory, extractedReferences);
    
    return finalHistory;
  }
  
  /**
   * Extracts references from the history and replaces them with marker placeholders.
   */
  private extractReferences(history: Content[]): { 
    historyWithMarkers: Content[], 
    extractedReferences: Array<{ id: string, reference: string, type: 'url' | 'filepath' | 'citation' }> 
  } {
    const extractedReferences: Array<{ id: string, reference: string, type: 'url' | 'filepath' | 'citation' }> = [];
    const historyWithMarkers = history.map(message => {
      const text = MessageUtils.getTextContent(message);
      
      // Create a copy of the message to avoid mutating the original
      const newMessage = { ...message, parts: [...message.parts] };
      let modifiedText = text;
      
      // 1. Extract URLs
      // Regex for URLs - handles http, https, ftp with various TLDs and paths
      const urlRegex = /(https?|ftp):\/\/[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g;
      let urlMatch: RegExpExecArray | null;
      
      while ((urlMatch = urlRegex.exec(text)) !== null) {
        const url = urlMatch[0];
        const referenceId = `URL_REFERENCE_${extractedReferences.length}_${Date.now()}`;
        
        extractedReferences.push({
          id: referenceId,
          reference: url,
          type: 'url'
        });
        
        modifiedText = modifiedText.replace(url, `[${referenceId}]`);
      }
      
      // 2. Extract file paths
      // Regex for common file paths (Windows, Unix, relative paths)
      const filePathRegex = /(?:[a-zA-Z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*|(?:\.{0,2}\/)?(?:[^\/\s:*?"<>|\r\n]+\/)*[^\/\s:*?"<>|\r\n]+)\.(?:[a-zA-Z0-9]+)/g;
      let filePathMatch: RegExpExecArray | null;
      
      while ((filePathMatch = filePathRegex.exec(text)) !== null) {
        const filePath = filePathMatch[0];
        const referenceId = `FILE_PATH_REFERENCE_${extractedReferences.length}_${Date.now()}`;
        
        extractedReferences.push({
          id: referenceId,
          reference: filePath,
          type: 'filepath'
        });
        
        modifiedText = modifiedText.replace(filePath, `[${referenceId}]`);
      }
      
      // 3. Extract citations (in various formats [1], (Author, Year), etc.)
      const citationRegex = /\[([^\]]+)\]|\(([A-Za-z]+ (?:et al\.)?, \d{4}[a-z]?)\)/g;
      let citationMatch: RegExpExecArray | null;
      
      while ((citationMatch = citationRegex.exec(text)) !== null) {
        const citation = citationMatch[0];
        const referenceId = `CITATION_REFERENCE_${extractedReferences.length}_${Date.now()}`;
        
        extractedReferences.push({
          id: referenceId,
          reference: citation,
          type: 'citation'
        });
        
        modifiedText = modifiedText.replace(citation, `[${referenceId}]`);
      }
      
      // Only update the message if we found and replaced references
      if (modifiedText !== text) {
        newMessage.parts = newMessage.parts.map(part => 
          typeof part === 'object' && 'text' in part ? { text: modifiedText } : part
        );
      }
      
      return newMessage;
    });
    
    return { historyWithMarkers, extractedReferences };
  }
  
  /**
   * Reinserts preserved references back into the summarized history.
   */
  private reinsertReferences(history: Content[], references: Array<{ id: string, reference: string, type: string }>): Content[] {
    if (references.length === 0) {
      return history; // No references to reinsert
    }
    
    return history.map(message => {
      const text = MessageUtils.getTextContent(message);
      
      // Create a copy of the message to avoid mutating the original
      const newMessage = { ...message, parts: [...message.parts] };
      
      // Try to find markers for references
      let modifiedText = text;
      
      // For each reference, check if its marker exists in this message
      for (const { id, reference } of references) {
        const markerRegex = new RegExp(`\\[${id}\\]`, 'g');
        if (markerRegex.test(modifiedText)) {
          // Replace the marker with the original reference
          modifiedText = modifiedText.replace(markerRegex, reference);
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
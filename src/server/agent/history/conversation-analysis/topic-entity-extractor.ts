// src/server/agent/history/topic-entity-extractor.ts
import { Content } from '@google/generative-ai';
import { MessageUtils } from './message-utils';
import logger from '../../logger';
import { agentConfig } from '../agent-config';
import { getGeminiClient } from '../../llm/gemini/client';
import { extractTextFromResult } from '../../llm/gemini/parsing';

/**
 * Service that extracts topics, entities, and programming languages from a conversation
 * using a combination of heuristics and lightweight models.
 */
export class TopicEntityExtractor {
  // Common programming languages for quick pattern matching
  private readonly programmingLanguagePatterns: Record<string, RegExp> = {
    'python': /\bpython\b|\.py\b|\bimport\s+[a-zA-Z_][a-zA-Z0-9_]*|def\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(/gi,
    'typescript': /\btypescript\b|\bts\b|\.ts\b|\binterface\b|\btype\b|:\s*[A-Z][a-zA-Z]+(\[\])?/gi,
    'javascript': /\bjavascript\b|\bjs\b|\.js\b|\bconst\b|\blet\b|\bfunction\b|\=\>|import\s+.*?from/gi,
    'html': /\bhtml\b|\.html\b|\<\/?[a-z][a-z0-9]*\>|\<\!DOCTYPE/gi,
    'css': /\bcss\b|\.css\b|\b[a-z-]+\s*:\s*[^;]+;/gi,
    'java': /\bjava\b|\.java\b|\bpublic\s+class\b|\bprivate\b|\bprotected\b/gi,
    'csharp': /\bc#\b|\.cs\b|\busing\s+[A-Za-z.]+;|\bnamespace\b|\bpublic\s+class\b/gi,
    'cpp': /\bc\+\+\b|\bcpp\b|\.cpp\b|\#include\b/gi,
    'go': /\bgo\b|\.go\b|\bfunc\b|\bpackage\s+[a-z][a-z0-9_]*/gi,
    'rust': /\brust\b|\.rs\b|\bfn\b|\blet\s+mut\b|\buse\s+std/gi,
    'ruby': /\bruby\b|\.rb\b|\bdef\b|\bend\b|\bmodule\b/gi,
    'php': /\bphp\b|\.php\b|\becho\b|\b\$_[A-Z]+\b/gi,
    'sql': /\bsql\b|\bselect\b.*?\bfrom\b|\bcreate\s+table\b|\binsert\s+into\b/gi,
    'bash': /\bbash\b|\bsh\b|\b\.sh\b|\becho\b|\bgrep\b|\bsed\b|\bawk\b/gi
  };

  /**
   * Extracts main programming languages discussed in the conversation
   * using pattern matching and heuristics.
   * 
   * @param history The conversation history
   * @returns Array of detected programming languages
   */
  async extractProgrammingLanguages(history: Content[]): Promise<string[]> {
    const detectedLanguages = new Map<string, number>();
    const allText = history.map(msg => MessageUtils.getTextContent(msg)).join(' ');
    
    // Detect programming languages using regex patterns
    for (const [lang, pattern] of Object.entries(this.programmingLanguagePatterns)) {
      const matches = allText.match(pattern);
      if (matches) {
        detectedLanguages.set(lang, matches.length);
      }
    }
    
    // Look for code blocks and try to detect language specifiers
    const codeBlockPattern = /```(\w*)([\s\S]*?)```/g;
    let match;
    while ((match = codeBlockPattern.exec(allText)) !== null) {
      const specifiedLang = match[1].toLowerCase().trim();
      if (specifiedLang) {
        detectedLanguages.set(specifiedLang, (detectedLanguages.get(specifiedLang) || 0) + 5);
      }
    }
    
    // Sort by frequency and return top languages
    const sortedLangs = Array.from(detectedLanguages.entries())
      .filter(([_, count]) => count >= 3) // Apply threshold to avoid false positives
      .sort((a, b) => b[1] - a[1])
      .map(([lang]) => lang);
    
    return sortedLangs.slice(0, 3); // Return top 3 languages
  }
  
  /**
   * Extracts main topics from the conversation using TF-IDF-like approach.
   * 
   * @param history The conversation history
   * @returns Array of main topic keywords, sorted by relevance
   */
  async extractTopics(history: Content[]): Promise<string[]> {
    const userMessages = history.filter(msg => msg.role === 'user');
    if (userMessages.length === 0) {
      return [];
    }
    
    // Extract text content from user messages
    const userText = userMessages.map(msg => MessageUtils.getTextContent(msg)).join(' ');
    
    // For very short conversations, use a lightweight approach
    if (userText.length < 500) {
      return this.extractKeywordsFromText(userText);
    }
    
    try {
      // For longer conversations, use a more sophisticated approach with the model
      const client = getGeminiClient();
      const model = client.getGenerativeModel({ 
        model: "gemini-1.0-pro", 
        generationConfig: { temperature: 0.1, maxOutputTokens: 50 }
      });
      
      // Create a condensed representation of the user's side of the conversation
      const condensedText = userMessages.map(msg => 
        MessageUtils.getTextContent(msg).substring(0, 200)
      ).join('\n\n').substring(0, 2000);
      
      const prompt = `Extract 3-5 main topics from this conversation snippet. 
      Return only a JSON array of topic strings, no explanation:
      ${condensedText}`;
      
      const result = await model.generateContent({ 
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });
      
      const analysisText = extractTextFromResult(result);
      
      // Parse the JSON response
      try {
        const jsonStartIndex = analysisText.indexOf('[');
        const jsonEndIndex = analysisText.lastIndexOf(']') + 1;
        
        if (jsonStartIndex >= 0 && jsonEndIndex > jsonStartIndex) {
          const jsonContent = analysisText.substring(jsonStartIndex, jsonEndIndex);
          const topics = JSON.parse(jsonContent);
          return Array.isArray(topics) ? topics : this.extractKeywordsFromText(userText);
        }
      } catch (parseError) {
        logger.debug('Error parsing topic extraction response, falling back to keyword extraction', parseError);
      }
      
      // Fall back to keyword extraction if JSON parsing fails
      return this.extractKeywordsFromText(userText);
      
    } catch (error) {
      logger.debug('Error in model-based topic extraction, falling back to keyword extraction', error);
      return this.extractKeywordsFromText(userText);
    }
  }
  
  /**
   * Extracts named entities from the conversation.
   * 
   * @param history The conversation history
   * @returns Array of detected named entities
   */
  async extractEntities(history: Content[]): Promise<string[]> {
    const allText = history.map(msg => MessageUtils.getTextContent(msg)).join(' ');
    
    // For short texts, use pattern matching
    if (allText.length < 1000) {
      return this.extractPotentialEntities(allText);
    }
    
    // For longer texts, try using the model for better extraction
    try {
      const client = getGeminiClient();
      const model = client.getGenerativeModel({ 
        model: "gemini-1.0-pro", 
        generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
      });
      
      // Use a truncated version of the text
      const truncatedText = allText.substring(0, 4000);
      
      const prompt = `Extract technical terms, domain-specific jargon, and named entities from this text.
      Return only a JSON array of entity strings, no explanation:
      ${truncatedText}`;
      
      const result = await model.generateContent({ 
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });
      
      const analysisText = extractTextFromResult(result);
      
      // Parse the JSON response
      try {
        const jsonStartIndex = analysisText.indexOf('[');
        const jsonEndIndex = analysisText.lastIndexOf(']') + 1;
        
        if (jsonStartIndex >= 0 && jsonEndIndex > jsonStartIndex) {
          const jsonContent = analysisText.substring(jsonStartIndex, jsonEndIndex);
          const entities = JSON.parse(jsonContent);
          return Array.isArray(entities) ? entities : this.extractPotentialEntities(truncatedText);
        }
      } catch (parseError) {
        logger.debug('Error parsing entity extraction response, falling back to pattern matching', parseError);
      }
      
      // Fall back to pattern matching if JSON parsing fails
      return this.extractPotentialEntities(truncatedText);
      
    } catch (error) {
      logger.debug('Error in model-based entity extraction, falling back to pattern matching', error);
      return this.extractPotentialEntities(allText);
    }
  }
  
  /**
   * Extracts keywords from text using a TF-IDF-like approach
   * This is a lightweight approach that doesn't need external services
   */
  private extractKeywordsFromText(text: string): string[] {
    // Normalize text: lowercase and remove punctuation
    const normalizedText = text.toLowerCase().replace(/[^\w\s]/g, ' ');
    
    // Tokenize text
    const words = normalizedText.split(/\s+/).filter(word => word.length > 2);
    
    // Count word frequencies
    const wordFrequencies = new Map<string, number>();
    for (const word of words) {
      wordFrequencies.set(word, (wordFrequencies.get(word) || 0) + 1);
    }
    
    // Remove common stop words
    const stopWords = new Set([
      'the', 'and', 'that', 'have', 'for', 'not', 'this', 'with', 'you', 'but',
      'from', 'they', 'will', 'would', 'there', 'their', 'what', 'about', 'which',
      'when', 'make', 'like', 'time', 'just', 'him', 'know', 'take', 'into', 'your',
      'some', 'could', 'them', 'than', 'then', 'look', 'only', 'come', 'over', 'think'
    ]);
    
    for (const stopWord of stopWords) {
      wordFrequencies.delete(stopWord);
    }
    
    // Sort by frequency
    const sortedWords = Array.from(wordFrequencies.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([word]) => word);
    
    return sortedWords.slice(0, 5); // Return top 5 keywords
  }
  
  /**
   * Extracts potential named entities using pattern matching
   */
  private extractPotentialEntities(text: string): string[] {
    // Potential entities are capitalized phrases, proper nouns, or technical terms
    
    // Extract capitalized phrases (potential proper nouns)
    const capitalizedPhrasePattern = /\b[A-Z][a-z]{2,}\b/g;
    const capitalizedMultiWordPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
    
    // Extract technical terms and jargon
    const technicalTermPatterns = [
      // Files and extensions
      /\b[\w-]+\.(js|ts|py|java|cs|cpp|go|rs|rb|php|html|css|json|xml|yaml|md)\b/g,
      
      // Technology frameworks/libraries
      /\b(React|Angular|Vue|Express|Django|Flask|Spring|ASP\.NET|Laravel|Rails)\b/g,
      
      // Technical concepts
      /\b(API|REST|GraphQL|JSON|XML|HTTP|HTTPS|WebSocket|OAuth|JWT)\b/g,
      
      // Computing terms
      /\b(algorithm|function|method|class|interface|component|module|service|controller|middleware|hook)\b/gi
    ];
    
    const entities = new Set<string>();
    
    // Extract capitalized phrases
    let match;
    while ((match = capitalizedPhrasePattern.exec(text)) !== null) {
      entities.add(match[0]);
    }
    
    // Extract multi-word capitalized phrases
    while ((match = capitalizedMultiWordPattern.exec(text)) !== null) {
      entities.add(match[0]);
    }
    
    // Extract technical terms
    for (const pattern of technicalTermPatterns) {
      while ((match = pattern.exec(text)) !== null) {
        entities.add(match[0]);
      }
    }
    
    // Convert to array, filter very short terms, and limit results
    return Array.from(entities)
      .filter(entity => entity.length > 2)
      .slice(0, 20);
  }
}
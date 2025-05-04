// src/server/agent/history/conversation-analyzer-service.ts
import { Content } from '@google/generative-ai';
import { ConversationAnalyzer } from './conversation-analyzer';
import { TopicEntityExtractor } from './topic-entity-extractor';
import { ImportanceScorer } from './importance-scorer';
import logger from '../../logger';
import { agentConfig } from '../agent-config';
import { ScoredMessage } from './types'; // Added import

/**
 * Analysis strategy options for conversation understanding
 */
export enum AnalysisStrategy {
  /**
   * Lightweight regex-based approach (original implementation)
   * Fastest option with lowest quality, but sufficient for many cases
   */
  REGEX_BASED = 'regex_based',
  
  /**
   * Mid-level analysis using topic modeling and entity extraction
   * Good balance of speed and quality for most conversations
   */
  TOPIC_ENTITY = 'topic_entity',
  
  /**
   * Deep semantic analysis using LLM for thorough understanding
   * Highest quality but most expensive in terms of tokens/latency
   */
  LLM_SEMANTIC = 'llm_semantic'
}

/**
 * Result of a conversation analysis
 */
export interface ConversationAnalysisResult {
  /** Main topics in the conversation */
  topics: string[];
  
  /** Programming languages detected in the conversation */
  programmingLanguages: string[];
  
  /** Named entities found in the conversation */
  entities: string[];
  
  /** Priority messages that should be preserved */
  priorityMessages: number[];
  
  /** Messages that can be compressed or summarized */
  compressibleMessages: number[];
  
  /** Strategy used for this analysis */
  strategyUsed: AnalysisStrategy;
  
  /** Processing time in milliseconds */
  processingTimeMs: number;
}

/**
 * Service that provides multiple strategies for conversation analysis
 */
export class ConversationAnalyzerService {
  private readonly legacyAnalyzer: ConversationAnalyzer;
  private readonly topicEntityExtractor: TopicEntityExtractor;
  private readonly importanceScorer: ImportanceScorer;
  
  constructor() {
    this.legacyAnalyzer = new ConversationAnalyzer();
    this.topicEntityExtractor = new TopicEntityExtractor();
    this.importanceScorer = new ImportanceScorer();
  }
  
  /**
   * Recommends an analysis strategy based on a quick heuristic assessment
   * of the conversation history.
   * 
   * @param history The conversation history
   * @returns The recommended AnalysisStrategy
   */
  recommendStrategy(history: Content[]): AnalysisStrategy {
    let codeBlockCount = 0;
    let referenceCount = 0;
    let totalLength = 0;
    const historyLength = history.length;

    const codeBlockPattern = /```[\s\S]*?```/g;
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    const filePathPattern = /(?:[a-zA-Z]:\\[\w\-.\\]+)|(?:\/[\w\-./]+\.\w+)/g;

    for (const message of history.slice(-10)) { // Analyze recent messages
      const text = this.getTextContent(message);
      totalLength += text.length;
      const codeMatches = text.match(codeBlockPattern);
      if (codeMatches) codeBlockCount += codeMatches.length;
      const urlMatches = text.match(urlPattern);
      if (urlMatches) referenceCount += urlMatches.length;
      const filePathMatches = text.match(filePathPattern);
      if (filePathMatches) referenceCount += filePathMatches.length;
    }

    // --- Decision Logic ---

    // 1. Use LLM_SEMANTIC if complex and long enough
    if (
      historyLength > 15 && 
      totalLength > 8000 &&
      (codeBlockCount > 2 || referenceCount > 3) // Indicators of complexity
    ) {
      logger.debug("Recommending LLM_SEMANTIC strategy based on complexity and length.");
      return AnalysisStrategy.LLM_SEMANTIC;
    }

    // 2. Use TOPIC_ENTITY for moderately complex or long conversations
    if (
      historyLength > 5 || 
      totalLength > 1500 || 
      codeBlockCount > 0 || 
      referenceCount > 1
    ) {
      logger.debug("Recommending TOPIC_ENTITY strategy based on content or length.");
      return AnalysisStrategy.TOPIC_ENTITY;
    }

    // 3. Default to REGEX_BASED for short/simple conversations
    logger.debug("Recommending REGEX_BASED strategy for simple/short conversation.");
    return AnalysisStrategy.REGEX_BASED;
  }
  
  /**
   * Analyze a conversation using the specified strategy
   * 
   * @param history The conversation history
   * @param strategy The analysis strategy to use
   * @returns Analysis results
   */
  async analyzeConversation(
    history: Content[], 
    strategy: AnalysisStrategy = AnalysisStrategy.TOPIC_ENTITY
  ): Promise<ConversationAnalysisResult> {
    const startTime = Date.now();
    
    let result: ConversationAnalysisResult = {
      topics: [],
      programmingLanguages: [],
      entities: [],
      priorityMessages: [],
      compressibleMessages: [],
      strategyUsed: strategy,
      processingTimeMs: 0
    };
    
    try {
      switch (strategy) {
        case AnalysisStrategy.REGEX_BASED:
          // Use the original regex-based approach
          result = await this.performRegexBasedAnalysis(history);
          break;
          
        case AnalysisStrategy.TOPIC_ENTITY:
          // Use the mid-level topic and entity extraction
          result = await this.performTopicEntityAnalysis(history);
          break;
          
        case AnalysisStrategy.LLM_SEMANTIC:
          // Use deep semantic understanding with LLM
          result = await this.performLLMSemanticAnalysis(history);
          break;
          
        default:
          logger.warn(`Unknown analysis strategy: ${strategy}, falling back to TOPIC_ENTITY`);
          result = await this.performTopicEntityAnalysis(history);
      }
    } catch (error) {
      // On failure, fall back to the most reliable strategy (regex)
      logger.error(`Error in conversation analysis with strategy ${strategy}`, error);
      result = await this.performRegexBasedAnalysis(history);
      result.strategyUsed = AnalysisStrategy.REGEX_BASED; // Override to indicate fallback
    }
    
    result.processingTimeMs = Date.now() - startTime;
    return result;
  }
  
  /**
   * Perform regex-based analysis (original implementation)
   */
  private async performRegexBasedAnalysis(history: Content[]): Promise<ConversationAnalysisResult> {
    // Basic regex strategy doesn't identify specific important messages
    const priorityIndices: number[] = [];
    const compressibleIndices: number[] = [];

    // Extract basic programming languages using regex
    const programmingLanguagePattern = 
      /\b(javascript|typescript|python|java|c\+\+|c#|ruby|go|rust|php|sql)\b/gi;
    const allText = history.map(msg => this.getTextContent(msg)).join(' ');
    const languageMatches = [...new Set(
      [...allText.matchAll(programmingLanguagePattern)]
        .map(match => match[1].toLowerCase())
    )];
    
    return {
      topics: [],  // No topic extraction in legacy mode
      programmingLanguages: languageMatches,
      entities: [],  // No entity extraction in legacy mode
      priorityMessages: priorityIndices,
      compressibleMessages: compressibleIndices,
      strategyUsed: AnalysisStrategy.REGEX_BASED,
      processingTimeMs: 0  // Will be updated by caller
    };
  }
  
  /**
   * Perform mid-level analysis using topic modeling and entity extraction
   */
  private async performTopicEntityAnalysis(history: Content[]): Promise<ConversationAnalysisResult> {
    // Extract topics and entities using TopicEntityExtractor
    const [topics, programmingLanguages, entities] = await Promise.all([
      this.topicEntityExtractor.extractTopics(history),
      this.topicEntityExtractor.extractProgrammingLanguages(history),
      this.topicEntityExtractor.extractEntities(history)
    ]);
    
    // Use ImportanceScorer for more nuanced message importance
    const scoredHistory: ScoredMessage[] = 
      this.importanceScorer.scoreHistoryImportance(history); // Corrected method name
      
    // Extract indices based on score threshold
    const priorityIndices: number[] = [];
    const compressibleIndices: number[] = [];
    scoredHistory.forEach((msg, index) => {
      if ((msg.importanceScore || 0) >= agentConfig.importanceScoring.minImportanceScoreToPreserve) {
        priorityIndices.push(index);
      } else {
        compressibleIndices.push(index);
      }
    });
      
    return {
      topics,
      programmingLanguages,
      entities,
      priorityMessages: priorityIndices,
      compressibleMessages: compressibleIndices,
      strategyUsed: AnalysisStrategy.TOPIC_ENTITY,
      processingTimeMs: 0  // Will be updated by caller
    };
  }
  
  /**
   * Perform deep semantic analysis using LLM
   */
  private async performLLMSemanticAnalysis(history: Content[]): Promise<ConversationAnalysisResult> {
    // First get the results from topic-entity analysis as a base
    const baseResults = await this.performTopicEntityAnalysis(history);
    
    // Enhance with LLM-specific analysis if needed in the future
    return {
      ...baseResults, // Includes priority/compressible messages from ImportanceScorer
      strategyUsed: AnalysisStrategy.LLM_SEMANTIC
    };
  }
  
  /**
   * Helper method to extract text content from a message
   */
  private getTextContent(message: Content): string {
    if (!message.parts) {
      return '';
    }
    
    return message.parts.map(part => {
      if (typeof part === 'string') {
        return part;
      } else if (part.text) {
        return part.text;
      }
      return '';
    }).join(' ');
  }
}
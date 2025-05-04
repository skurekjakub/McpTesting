// src/server/agent/history/conversation-analyzer.ts
import { Content } from '@google/generative-ai';
import logger from '../../logger';
// Import strategies and pattern matcher
import { HeuristicAnalyzerStrategy } from './heuristic-analyzer-strategy';
import { LLMAnalyzerStrategy } from './llm-analyzer-strategy';
import { PatternMatcher } from './pattern-matcher';
// Import types
import { 
  ConversationAnalysisResult, 
  ConversationPattern, 
  AnalysisOptions, 
  IConversationAnalyzerStrategy
} from './types';

/**
 * Orchestrates conversation analysis using different strategies.
 * It combines results from heuristic and potentially LLM-based analysis,
 * identifies conversation patterns, and determines optimization recommendations.
 */
export class ConversationAnalyzer {
  private heuristicAnalyzer: IConversationAnalyzerStrategy;
  private llmAnalyzer: IConversationAnalyzerStrategy;
  private patternMatcher: PatternMatcher;

  constructor() {
    this.heuristicAnalyzer = new HeuristicAnalyzerStrategy();
    this.llmAnalyzer = new LLMAnalyzerStrategy();
    this.patternMatcher = new PatternMatcher();
  }

  /**
   * Analyze conversation history using a combination of heuristic and LLM approaches.
   * 
   * @param history Conversation history to analyze.
   * @param options Analysis configuration options.
   * @returns A comprehensive analysis result with conversation characteristics and recommendations.
   */
  async analyzeConversation(
    history: Content[],
    options: AnalysisOptions = {}
  ): Promise<ConversationAnalysisResult> {
    const {
      includeLLMAnalysis = true, // Default to including LLM analysis
    } = options;
    
    // 1. Start with heuristic analysis (always run, it's fast)
    const heuristicAnalysis = await this.heuristicAnalyzer.analyze(history, options);
    
    // 2. Perform LLM-based analysis if requested
    let llmAnalysis: Partial<ConversationAnalysisResult> = {};
    let rawAnalysis = '';
    
    if (includeLLMAnalysis) {
      try {
        llmAnalysis = await this.llmAnalyzer.analyze(history, options);
        rawAnalysis = llmAnalysis.rawAnalysis || '';
      } catch (error) {
        // Log error, but continue with heuristic analysis
        logger.warn(`ConversationAnalyzer: LLM analysis failed - ${error}. Using only heuristic analysis.`);
        rawAnalysis = `LLM analysis failed: ${error}`;
      }
    }
    
    // 3. Merge results (LLM takes precedence)
    // Initialize with defaults for all fields
    const mergedResult: ConversationAnalysisResult = {
      hasTechnicalContent: false,
      codeBlockCount: 0,
      containsCodeSnippets: false,
      urlCount: 0,
      filePathCount: 0,
      containsReferences: false,
      openQuestionCount: 0,
      answeredQuestionCount: 0,
      hasOpenQuestions: false,
      averageMessageLength: 0,
      isVerbose: false,
      primaryTopic: '',
      secondaryTopics: [],
      conversationPattern: ConversationPattern.GENERAL_CHAT, // Default pattern
      recommendedOptimizations: {
        preserveCode: false,
        preserveReferences: false, 
        trackOpenQuestions: false,
        reduceVerbosity: false
      },
      rawAnalysis: rawAnalysis, // Store raw LLM response if available
      ...heuristicAnalysis, // Apply heuristic results first
      ...llmAnalysis, // Override with LLM results where available
    };
    
    // 4. Identify conversation pattern based on merged results
    mergedResult.conversationPattern = this.patternMatcher.identifyConversationPattern(mergedResult);
    
    // 5. Set initial recommendations based on merged analysis
    mergedResult.recommendedOptimizations = {
      preserveCode: mergedResult.containsCodeSnippets || mergedResult.codeBlockCount > 0,
      preserveReferences: mergedResult.containsReferences || mergedResult.urlCount + mergedResult.filePathCount > 0,
      trackOpenQuestions: mergedResult.hasOpenQuestions || mergedResult.openQuestionCount > 0,
      // Reduce verbosity only if LLM analysis confirmed it or heuristic is very high
      reduceVerbosity: mergedResult.isVerbose && mergedResult.averageMessageLength > 1000 
    };
    
    // 6. Adjust recommendations based on the identified pattern
    this.patternMatcher.adjustRecommendationsBasedOnPattern(mergedResult);
    
    return mergedResult;
  }

  /**
   * Get a description of the identified conversation pattern.
   * Delegates to the PatternMatcher.
   */
  getPatternDescription(pattern: ConversationPattern): string {
    return this.patternMatcher.getPatternDescription(pattern);
  }

  // Removed static PATTERN_DEFINITIONS
  // Removed static performHeuristicAnalysis
  // Removed static performLLMAnalysis
  // Removed static identifyConversationPattern
  // Removed static adjustRecommendationsBasedOnPattern
}
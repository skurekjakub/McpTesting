// src/server/agent/history/types.ts
import { Content } from '@google/generative-ai';

/**
 * Message with additional metadata for scoring importance
 */
export interface ScoredMessage extends Content {
  importanceScore?: number;
}

/**
 * Type for summarization mode options
 */
export type SummarizationMode = 'standard' | 'aggressive';

/**
 * Type for logging callback function used in history processing
 */
export type LogCallback = (message: string) => void;

/**
 * Result from a conversation analysis operation
 */
export interface ConversationAnalysisResult {
  // Content characteristics
  hasTechnicalContent: boolean;
  codeBlockCount: number;
  containsCodeSnippets: boolean;
  
  // Reference characteristics
  urlCount: number;
  filePathCount: number;
  containsReferences: boolean;
  
  // Question characteristics
  openQuestionCount: number;
  answeredQuestionCount: number;
  hasOpenQuestions: boolean;
  
  // Verbosity characteristics
  averageMessageLength: number;
  isVerbose: boolean;
  isCasual?: boolean; // Added
  isAssistantLike?: boolean; // Added
  
  // Topic characteristics
  primaryTopic: string;
  secondaryTopics: string[];
  
  // Pattern recognition
  conversationPattern: ConversationPattern;
  
  // Recommended optimizations
  recommendedOptimizations: {
    preserveCode: boolean;
    preserveReferences: boolean;
    trackOpenQuestions: boolean;
    reduceVerbosity: boolean;
    summarizationAggressiveness?: 'normal' | 'high'; // Added
  };
  
  // Raw analysis details (for debugging/logging)
  rawAnalysis: string;
}

/**
 * Recognized conversation patterns that can inform history management
 */
export enum ConversationPattern {
  GENERAL_CHAT = 'general_chat',
  CODE_DEVELOPMENT = 'code_development',
  DEBUGGING_SESSION = 'debugging_session',
  RESEARCH_FOCUSED = 'research_focused',
  QUESTION_ANSWERING = 'question_answering',
  TASK_BASED = 'task_based',
  CASUAL_CONVERSATION = 'casual_conversation', // Added
  EXPLORATION = 'exploration'
}

/**
 * Pattern characteristics used for pattern matching
 */
export interface PatternCharacteristics {
  hasTechnicalContent: boolean;
  codeBlockThreshold: number;
  questionThreshold: number;
  referenceThreshold: number;
  patternDescription: string;
}

/**
 * Options for conversation analysis
 */
export interface AnalysisOptions {
  maxMessagesToAnalyze?: number;
  includeLLMAnalysis?: boolean;
  analysisTemperature?: number;
}

// --- Analysis Strategy Interface ---

/**
 * Interface for different conversation analysis strategies.
 */
export interface IConversationAnalyzerStrategy {
  /**
   * Analyzes the conversation history based on the strategy's implementation.
   * 
   * @param history The conversation history to analyze.
   * @param options Optional configuration for the analysis.
   * @returns A partial analysis result based on the strategy's focus.
   */
  analyze(
    history: Content[], 
    options?: AnalysisOptions
  ): Promise<Partial<ConversationAnalysisResult>>;
}
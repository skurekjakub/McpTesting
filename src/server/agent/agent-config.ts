// src/server/agent/agent-config.ts
import { agentConfig as configuredAgentOptions } from '../config/agent';
import { llmConfig } from '../config/llm';

// --- Internal defaults for importance scoring ---
const DEFAULT_IMPORTANCE_SCORING_ENABLED = true;
const DEFAULT_KEYWORD_IMPORTANCE_WEIGHT = 0.35;
const DEFAULT_RECENCY_IMPORTANCE_WEIGHT = 0.25;
const DEFAULT_LENGTH_IMPORTANCE_WEIGHT = 0.15;
const DEFAULT_RESPONSE_IMPORTANCE_WEIGHT = 0.25;
const DEFAULT_MIN_IMPORTANCE_SCORE_TO_PRESERVE = 0.7;
const DEFAULT_IMPORTANT_KEYWORDS = [
  'important', 'critical', 'remember', 'key', 'essential', 'crucial',
  'necessary', 'vital', 'significant', 'priority', 'must', 'should',
  'function', 'class', 'method', 'implementation', 'architecture', 
  'design', 'pattern', 'solution', 'approach', 'decision'
];

/**
 * Configuration parameters specific to the agent architecture.
 * Centralizes all configuration values that were previously hardcoded
 * in various components.
 */
export const agentConfig = {
  // Core agent execution parameters
  execution: {
    maxFunctionCallsPerTurn: configuredAgentOptions.MAX_FUNCTION_CALLS_PER_TURN,
    defaultGenerationTemperature: llmConfig.GENERATION_TEMPERATURE,
  },
  
  // History management parameters
  history: {
    messagesToKeepUnsummarized: configuredAgentOptions.RECENT_MESSAGES_TO_PRESERVE,
    summaryMessagePrefix: configuredAgentOptions.SUMMARY_MESSAGE_PREFIX,
  },
  
  // System instruction paths
  paths: {
    systemInstructionFilename: configuredAgentOptions.SYSTEM_INSTRUCTION_FILENAME,
    systemInstructionDirectory: configuredAgentOptions.SYSTEM_INSTRUCTION_DIRECTORY,
    summarizerInstructionFilename: configuredAgentOptions.SUMMARIZER_INSTRUCTION_FILENAME,
  },
  
  // Error messages and defaults
  defaults: {
    defaultSystemInstruction: 'Default system instruction if file loading fails.',
    executionFailedMessage: 'Error: Processing failed to produce a response.',
    maxTokensWarning: '(Warning: Response may be truncated due to maximum token limit.)',
  },

  // Summarization settings (pulling from main config)
  summarization: {
    threshold: configuredAgentOptions.SUMMARIZATION_THRESHOLD_TOKENS,
    costOptimizationEnabled: configuredAgentOptions.COST_OPTIMIZATION_ENABLED,
    recentMessagesToPreserve: configuredAgentOptions.RECENT_MESSAGES_TO_PRESERVE,
    deepHistoryThreshold: configuredAgentOptions.DEEP_HISTORY_THRESHOLD,
    targetCompressionRatio: configuredAgentOptions.TARGET_COMPRESSION_RATIO,
  },
  
  // Contextual importance scoring settings - internal implementation detail
  importanceScoring: {
    enabled: DEFAULT_IMPORTANCE_SCORING_ENABLED,
    keywordImportanceWeight: DEFAULT_KEYWORD_IMPORTANCE_WEIGHT,
    recencyImportanceWeight: DEFAULT_RECENCY_IMPORTANCE_WEIGHT,
    lengthImportanceWeight: DEFAULT_LENGTH_IMPORTANCE_WEIGHT,
    responseImportanceWeight: DEFAULT_RESPONSE_IMPORTANCE_WEIGHT, 
    importantKeywords: DEFAULT_IMPORTANT_KEYWORDS,
    minImportanceScoreToPreserve: DEFAULT_MIN_IMPORTANCE_SCORE_TO_PRESERVE,
  },
  
  // Logging prefixes for consistent logging patterns
  logging: {
    agentExecutor: '[AgentExecutor]',
    promptManager: '[PromptManager]',
    historyManager: '[HistoryManager]',
    toolOrchestrator: '[ToolOrchestrator]',
  },
};
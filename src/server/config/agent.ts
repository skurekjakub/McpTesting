// src/server/config/agent.ts
import { z } from 'zod';
import { loadRawConfigData, validateSchema, BOT_CONFIG_DIR, getConfigValue } from './base';
import logger from '../logger';

// --- Default Values ---
const DEFAULT_MAX_FUNCTION_CALLS_PER_TURN = 25;
const DEFAULT_SUMMARIZATION_THRESHOLD_TOKENS = 16384;
const DEFAULT_RECENT_MESSAGES_TO_PRESERVE = 6;
const DEFAULT_DEEP_HISTORY_THRESHOLD = 8000;
const DEFAULT_TARGET_COMPRESSION_RATIO = 0.3;
const DEFAULT_SUMMARY_MESSAGE_PREFIX = 'Summary of earlier conversation:\n';
const DEFAULT_COST_OPTIMIZATION_ENABLED = true;
const DEFAULT_SYSTEM_INSTRUCTION_FILENAME = 'system_instruction.md';
const DEFAULT_SUMMARIZER_INSTRUCTION_FILENAME = 'system-instruction-summarizer.md';
const DEFAULT_HISTORY_ANALYZER_STRATEGY = 'semantic';

// --- Define Agent Configuration Schema ---
const AgentConfigSchema = z.object({
  // Execution parameters
  MAX_FUNCTION_CALLS_PER_TURN: z.number().int().positive().default(DEFAULT_MAX_FUNCTION_CALLS_PER_TURN),
  
  // Summarization settings
  SUMMARIZATION_THRESHOLD_TOKENS: z.number().int().positive().default(DEFAULT_SUMMARIZATION_THRESHOLD_TOKENS),
  COST_OPTIMIZATION_ENABLED: z.boolean().default(DEFAULT_COST_OPTIMIZATION_ENABLED),
  RECENT_MESSAGES_TO_PRESERVE: z.number().int().positive().default(DEFAULT_RECENT_MESSAGES_TO_PRESERVE),
  DEEP_HISTORY_THRESHOLD: z.number().int().positive().default(DEFAULT_DEEP_HISTORY_THRESHOLD),
  TARGET_COMPRESSION_RATIO: z.number().min(0.1).max(0.9).default(DEFAULT_TARGET_COMPRESSION_RATIO),
  SUMMARY_MESSAGE_PREFIX: z.string().default(DEFAULT_SUMMARY_MESSAGE_PREFIX),
  
  // Path settings
  SYSTEM_INSTRUCTION_FILENAME: z.string().default(DEFAULT_SYSTEM_INSTRUCTION_FILENAME),
  SYSTEM_INSTRUCTION_DIRECTORY: z.string().default(BOT_CONFIG_DIR),
  SUMMARIZER_INSTRUCTION_FILENAME: z.string().default(DEFAULT_SUMMARIZER_INSTRUCTION_FILENAME),

  HISTORY_ANALYZER_STRATEGY: z.enum(['regex', 'semantic']).default(DEFAULT_HISTORY_ANALYZER_STRATEGY), // 'regex' or 'semantic'
});

// --- Load and Process Configuration ---
const rawConfig = loadRawConfigData();

// --- Extract Agent Configuration from Raw Data using hierarchical paths ---
const combinedAgentConfig = {
  // Execution parameters
  MAX_FUNCTION_CALLS_PER_TURN: getConfigValue<number>(
    rawConfig, ['agent', 'execution', 'max_function_calls_per_turn'], 'max_function_calls_per_turn'
  ),
  
  // Summarization settings
  SUMMARIZATION_THRESHOLD_TOKENS: getConfigValue<number>(
    rawConfig, ['agent', 'history', 'summarization_threshold_tokens'], 'summarization_threshold_tokens'
  ),
  
  COST_OPTIMIZATION_ENABLED: getConfigValue<boolean>(
    rawConfig, ['agent', 'cost_optimization', 'enabled'], 'cost_optimization_enabled'
  ),
  
  RECENT_MESSAGES_TO_PRESERVE: getConfigValue<number>(
    rawConfig, ['agent', 'history', 'recent_messages_to_preserve'], 'recent_messages_to_preserve'
  ),
  
  DEEP_HISTORY_THRESHOLD: getConfigValue<number>(
    rawConfig, ['agent', 'cost_optimization', 'deep_history_threshold'], 'deep_history_threshold'
  ),
  
  TARGET_COMPRESSION_RATIO: getConfigValue<number>(
    rawConfig, ['agent', 'cost_optimization', 'target_compression_ratio'], 'target_compression_ratio'
  ),
  
  SUMMARY_MESSAGE_PREFIX: getConfigValue<string>(
    rawConfig, ['agent', 'history', 'summary_message_prefix'], 'summary_message_prefix'
  ),
  
  // Path settings
  SYSTEM_INSTRUCTION_FILENAME: getConfigValue<string>(
    rawConfig, ['agent', 'files', 'system_instruction_filename'], 'system_instruction_filename'
  ),
  
  SYSTEM_INSTRUCTION_DIRECTORY: getConfigValue<string>(
    rawConfig, ['agent', 'files', 'system_instruction_directory'], 'system_instruction_directory'
  ),
  
  SUMMARIZER_INSTRUCTION_FILENAME: getConfigValue<string>(
    rawConfig, ['agent', 'files', 'summarizer_instruction_filename'], 'summarizer_instruction_filename'
  ),

  HISTORY_ANALYZER_STRATEGY: getConfigValue<string>(
    rawConfig, ['agent', 'analysis', 'history_analyzer_strategy'], 'history_analyzer_strategy'
  ),
};

// --- Validate and Export Configuration ---
export const agentConfig = validateSchema(AgentConfigSchema, combinedAgentConfig, "Agent Configuration");

// --- Configuration Status Reporting ---
export function logAgentConfigStatus(): void {
  const configItems = [
    { name: "Max Function Calls Per Turn", value: agentConfig.MAX_FUNCTION_CALLS_PER_TURN },
    { name: "Summarization Threshold", value: `${agentConfig.SUMMARIZATION_THRESHOLD_TOKENS} tokens` },
    { name: "Cost Optimization Enabled", value: agentConfig.COST_OPTIMIZATION_ENABLED },
    { name: "Recent Messages to Preserve", value: agentConfig.RECENT_MESSAGES_TO_PRESERVE },
    { name: "Deep History Threshold", value: `${agentConfig.DEEP_HISTORY_THRESHOLD} tokens` },
    { name: "Target Compression Ratio", value: agentConfig.TARGET_COMPRESSION_RATIO },
    { name: "System Instruction Filename", value: agentConfig.SYSTEM_INSTRUCTION_FILENAME },
    { name: "Summarizer Instruction Filename", value: agentConfig.SUMMARIZER_INSTRUCTION_FILENAME },
  ];
  
  logger.info('--- Agent Configuration ---');
  configItems.forEach(item => {
    logger.info(`  ${item.name}: ${item.value}`);
  });
}
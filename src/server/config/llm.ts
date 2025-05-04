// src/server/config/llm.ts
import { z } from 'zod';
import { loadRawConfigData, validateSchema, getConfigValue } from './base';
import logger from '../logger';

// --- Default Values ---
const DEFAULT_GEMINI_MODEL = 'gemini-1.5-flash';
const DEFAULT_GENERATION_MODEL = 'gemini-1.5-flash';
const DEFAULT_SUMMARIZATION_MODEL = 'gemini-2.0-flash';
const DEFAULT_COST_EFFICIENT_SUMMARIZATION_MODEL = 'gemini-1.0-pro';
const DEFAULT_GENERATION_TEMPERATURE = 0.7;

// --- Define LLM Configuration Schema ---
const LlmConfigSchema = z.object({
  GEMINI_API_KEY: z.string().min(1, "Gemini API Key is required."),
  DEFAULT_GEMINI_MODEL: z.string().default(DEFAULT_GEMINI_MODEL),
  GENERATION_GEMINI_MODEL: z.string().default(DEFAULT_GENERATION_MODEL),
  SUMMARIZATION_MODEL_NAME: z.string().default(DEFAULT_SUMMARIZATION_MODEL),
  COST_EFFICIENT_SUMMARIZATION_MODEL: z.string().default(DEFAULT_COST_EFFICIENT_SUMMARIZATION_MODEL),
  GENERATION_TEMPERATURE: z.number().min(0).max(1).default(DEFAULT_GENERATION_TEMPERATURE),
});

// --- Load and Process Configuration ---
const rawConfig = loadRawConfigData();

// --- Extract LLM Configuration from Raw Data using hierarchical paths ---
const combinedLlmConfig = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || 
                 getConfigValue<string>(rawConfig, ['auth', 'gemini_api_key'], 'gemini_api_key'),
                 
  DEFAULT_GEMINI_MODEL: getConfigValue<string>(
    rawConfig, ['llm', 'models', 'default'], 'default_gemini_model'
  ),
  
  GENERATION_GEMINI_MODEL: getConfigValue<string>(
    rawConfig, ['llm', 'models', 'generation'], 'generation_gemini_model'
  ),
  
  SUMMARIZATION_MODEL_NAME: getConfigValue<string>(
    rawConfig, ['llm', 'models', 'summarization'], 'summarization_gemini_model'
  ),
  
  COST_EFFICIENT_SUMMARIZATION_MODEL: getConfigValue<string>(
    rawConfig, ['llm', 'models', 'cost_efficient_summarization'], 'cost_efficient_summarization_model'
  ),
  
  GENERATION_TEMPERATURE: getConfigValue<number>(
    rawConfig, ['llm', 'parameters', 'generation_temperature'], 'generation_temperature'
  ),
};

// --- Validate and Export Configuration ---
export const llmConfig = validateSchema(LlmConfigSchema, combinedLlmConfig, "LLM Configuration");

// --- Custom Validation for API Key ---
export function validateApiKey(): boolean {
  if (llmConfig.GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_GOES_HERE") {
    return false;
  }
  return true;
}

// --- Configuration Status Reporting ---
export function logLlmConfigStatus(): void {
  const configItems = [
    { name: "Default Gemini Model", value: llmConfig.DEFAULT_GEMINI_MODEL },
    { name: "Generation Gemini Model", value: llmConfig.GENERATION_GEMINI_MODEL },
    { name: "Summarization Model", value: llmConfig.SUMMARIZATION_MODEL_NAME },
    { name: "Cost-Efficient Summarization Model", value: llmConfig.COST_EFFICIENT_SUMMARIZATION_MODEL },
    { name: "Generation Temperature", value: llmConfig.GENERATION_TEMPERATURE },
  ];
  
  logger.info('--- LLM Configuration ---');
  configItems.forEach(item => {
    logger.info(`  ${item.name}: ${item.value}`);
  });
}
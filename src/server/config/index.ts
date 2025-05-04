// src/server/config/index.ts
import { resolvedProjectRoot, validationErrors } from './base';
import { llmConfig, validateApiKey, logLlmConfigStatus } from './llm';
import { agentConfig, logAgentConfigStatus } from './agent';
import { serverConfig, validateFilesystemPaths, validateChromaConfig, validateServerConfig, logServerConfigStatus } from './server';
import logger from '../logger';

// --- Export Individual Configurations ---
export { llmConfig, agentConfig, serverConfig, resolvedProjectRoot };

// --- Validate All Configuration Components ---
export function validateAllConfiguration(): boolean {
  logger.info("Validating hierarchical configuration...");
  
  // Clear any existing validation errors
  validationErrors.length = 0;
  
  // Check API Key
  if (!validateApiKey()) {
    validationErrors.push("ERROR: Gemini API Key is using a placeholder value. Please replace it.");
  } else {
    logger.info("  Gemini API Key: Loaded (source: ENV or config.json)");
  }
  
  // Validate filesystem paths
  validateFilesystemPaths();
  
  // Validate server settings
  logger.info(`  Enable Memory Server: ${serverConfig.ENABLE_MEMORY_SERVER}`);
  logger.info(`  Enable Chroma Server: ${serverConfig.ENABLE_CHROMA_SERVER}`);
  
  // Validate Chroma configuration if enabled
  if (serverConfig.ENABLE_CHROMA_SERVER) {
    validateChromaConfig();
  }
  
  // Check if at least one server type is configured
  validateServerConfig();
  
  // Log other configuration values
  logConfigurationSummary();
  
  // Determine if configuration is valid
  const configValid = validationErrors.length === 0;
  
  if (configValid) {
    logger.info("--- Configuration validation passed. ---");
  } else {
    logger.error("--- Configuration errors detected: ---");
    validationErrors.forEach(err => logger.error(`  - ${err}`));
    logger.error("--- Application might not function correctly. ---");
  }
  
  return configValid;
}

// --- Summarize Configuration ---
function logConfigurationSummary(): void {
  logger.info("\nConfiguration Summary:");
  
  // Log LLM configuration
  logLlmConfigStatus();
  
  // Log agent configuration
  logAgentConfigStatus();
  
  // Log server configuration
  logServerConfigStatus();
}

// --- Export Configuration Status ---
export const isConfigValid = validateAllConfiguration();
export const configValidationErrors = validationErrors;
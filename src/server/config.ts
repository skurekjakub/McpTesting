// src/server/config.ts
/**
 * Configuration Validation Layer
 * 
 * This file provides:
 * 1. Configuration validation functionality that works across all config modules
 * 2. Backward compatibility for older code that hasn't been migrated to use direct imports
 * 
 * New code should import directly from the appropriate configuration modules:
 * - import { llmConfig } from './config/llm';
 * - import { agentConfig } from './config/agent';
 * - import { serverConfig } from './config/server';
 * - import { resolvedProjectRoot } from './config/base';
 */

import {
  isConfigValid, 
  resolvedProjectRoot,
  configValidationErrors,
} from './config/index';

/**
 * Validates the configuration across all configuration modules
 * @returns True if configuration is valid, false otherwise
 */
export function validateConfig(): boolean {
  return isConfigValid;
}

// Export helpers for backward compatibility only
export { 
  isConfigValid, 
  resolvedProjectRoot,
  configValidationErrors,
};

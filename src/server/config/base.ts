// src/server/config/base.ts
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import logger from '../logger';

// --- Constants ---
export const CONFIG_FILENAME = 'config.json';
export const BOT_CONFIG_DIR = 'bot_config';

// Calculate project root using ES Module standards
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const resolvedProjectRoot = path.resolve(__dirname, '..', '..', '..'); 

// --- Load Raw Configuration Data ---
export function loadRawConfigData(): Record<string, unknown> {
  let configData: Record<string, unknown> = {};
  const configFilePath = path.join(resolvedProjectRoot, BOT_CONFIG_DIR, CONFIG_FILENAME);

  try {
    logger.info(`Attempting to load configuration from: ${configFilePath}`);
    if (fs.existsSync(configFilePath)) {
      const rawData = fs.readFileSync(configFilePath, 'utf-8');
      configData = JSON.parse(rawData);
      logger.info(`Successfully loaded configuration from ${CONFIG_FILENAME}`);
    } else {
      const warning = `WARNING: ${CONFIG_FILENAME} not found at ${configFilePath}. Using environment variables and defaults.`;
      logger.warn(warning);
    }
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      logger.error(`ERROR: Could not parse ${CONFIG_FILENAME}: ${error.message}. Using environment variables and defaults.`);
    } else if (error instanceof Error) {
      logger.error(`ERROR: Unexpected error loading ${CONFIG_FILENAME}: ${error.message}. Using environment variables and defaults.`);
    } else {
      logger.error(`ERROR: Unexpected non-error thrown loading ${CONFIG_FILENAME}: ${String(error)}. Using environment variables and defaults.`);
    }
  }

  return configData;
}

/**
 * Safely extracts a nested property from a hierarchical configuration object.
 * Works with both the original flat format and the new hierarchical format.
 */
export function getConfigValue<T>(
  config: Record<string, unknown>,
  hierarchicalPath: string[],
  legacyFlatKey: string
): T | undefined {
  try {
    // First, try to get from hierarchical format
    let current: unknown = config;
    for (const key of hierarchicalPath) {
      if (typeof current !== 'object' || current === null) {
        // Not an object or null, can't traverse further
        return undefined;
      }
      current = (current as Record<string, unknown>)[key];
    }
    
    if (current !== undefined) {
      return current as T;
    }
    
    // Fallback to flat key for backward compatibility
    return config[legacyFlatKey] as T;
  } catch (error) {
    logger.debug(`Config value not found for path ${hierarchicalPath.join('.')} or ${legacyFlatKey}`);
    return undefined;
  }
}

/**
 * Shared validation errors collection
 */
export const validationErrors: string[] = [];

/**
 * Type for validation metadata that can be attached to Zod schemas
 */
export interface ValidationMeta {
  configKey: string;
  description: string;
  category: string;
}

/**
 * Type-safe validation wrapper to ensure consistent error handling
 */
export function validateSchema<T extends z.ZodType>(
  schema: T, 
  data: Record<string, unknown>,
  logCategory = "Configuration"
): z.infer<T> {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.errors.forEach(err => {
        const path = err.path.join('.') || '<root>';
        logger.error(`  - Path: ${path}, Message: ${err.message}`);
        validationErrors.push(`Validation Error (${path}): ${err.message}`);
      });
    } else if (error instanceof Error) {
      logger.error(`--- Unexpected error during ${logCategory} validation: ---`, error);
      validationErrors.push(`Unexpected Validation Error: ${error.message}`);
    } else {
      logger.error(`--- Unexpected non-error thrown during ${logCategory} validation: ---`, error);
      validationErrors.push(`Unexpected Validation Error: ${String(error)}`);
    }
    
    // Return a best-effort attempt at creating defaults
    return schema.parse({});
  }
}
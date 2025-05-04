// src/server/config/server.ts
import { z } from 'zod';
import { loadRawConfigData, validateSchema, resolvedProjectRoot, getConfigValue } from './base';
import fs from 'fs';
import path from 'path';
import logger from '../logger';

// --- Default Values ---
const DEFAULT_FILESYSTEM_TARGET_DIRECTORIES: string[] = [];
const DEFAULT_ENABLE_MEMORY_SERVER = false;
const DEFAULT_ENABLE_CHROMA_SERVER = true;
const DEFAULT_CHROMA_PATH = './chroma_db';
const DEFAULT_CHROMA_COLLECTION = 'chat_memory';
const DEFAULT_MAX_DEBUG_LOG_SIZE = 1500;
const DEFAULT_LOG_PREVIEW_LEN = 250;

// --- Define Server Configuration Schema ---
const ServerConfigSchema = z.object({
  FILESYSTEM_TARGET_DIRECTORIES: z.array(z.string()).default(DEFAULT_FILESYSTEM_TARGET_DIRECTORIES),
  ENABLE_MEMORY_SERVER: z.boolean().default(DEFAULT_ENABLE_MEMORY_SERVER),
  ENABLE_CHROMA_SERVER: z.boolean().default(DEFAULT_ENABLE_CHROMA_SERVER),
  CHROMA_PATH: z.string().default(DEFAULT_CHROMA_PATH),
  CHROMA_COLLECTION_NAME: z.string().default(DEFAULT_CHROMA_COLLECTION),
  MAX_DEBUG_LOG_SIZE: z.number().int().positive().default(DEFAULT_MAX_DEBUG_LOG_SIZE),
  LOG_PREVIEW_LEN: z.number().int().positive().default(DEFAULT_LOG_PREVIEW_LEN),
});

// --- Load and Process Configuration ---
const rawConfig = loadRawConfigData();

// --- Extract Server Configuration from Raw Data using hierarchical paths ---
const combinedServerConfig = {
  FILESYSTEM_TARGET_DIRECTORIES: getConfigValue<string[]>(
    rawConfig, ['server', 'filesystem', 'target_directories'], 'filesystem_target_directories'
  ),
  
  ENABLE_MEMORY_SERVER: getConfigValue<boolean>(
    rawConfig, ['server', 'memory', 'enable_memory_server'], 'enable_memory_server'
  ),
  
  ENABLE_CHROMA_SERVER: getConfigValue<boolean>(
    rawConfig, ['server', 'chroma', 'enable_chroma_server'], 'enable_chroma_server'
  ),
  
  CHROMA_PATH: getConfigValue<string>(
    rawConfig, ['server', 'chroma', 'path'], 'chroma_path'
  ),
  
  CHROMA_COLLECTION_NAME: getConfigValue<string>(
    rawConfig, ['server', 'chroma', 'collection_name'], 'chroma_collection_name'
  ),
  
  MAX_DEBUG_LOG_SIZE: getConfigValue<number>(
    rawConfig, ['server', 'logging', 'max_debug_log_size'], 'max_debug_log_size'
  ),
  
  LOG_PREVIEW_LEN: getConfigValue<number>(
    rawConfig, ['server', 'logging', 'log_preview_len'], 'log_preview_len'
  ),
};

// --- Validate and Export Configuration ---
export const serverConfig = validateSchema(ServerConfigSchema, combinedServerConfig, "Server Configuration");

// --- Custom Validation Functions ---
export function validateFilesystemPaths(): boolean {
  if (serverConfig.FILESYSTEM_TARGET_DIRECTORIES.length === 0) {
    logger.info("  Filesystem Target Directories: None configured.");
    return true;
  }
  
  logger.info(`  Filesystem Target Directories (${serverConfig.FILESYSTEM_TARGET_DIRECTORIES.length}):`);
  let allPathsValid = true;
  
  serverConfig.FILESYSTEM_TARGET_DIRECTORIES.forEach((dirPath, i) => {
    const absolutePath = path.resolve(resolvedProjectRoot, dirPath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
      logger.error(`  - ERROR: Filesystem directory '${dirPath}' (Resolved: ${absolutePath}) (item #${i + 1}) not found or is not a directory.`);
      allPathsValid = false;
    } else {
      logger.info(`    - '${dirPath}' (Resolved: ${absolutePath}) [OK]`);
    }
  });
  
  return allPathsValid;
}

export function validateChromaConfig(): boolean {
  if (!serverConfig.ENABLE_CHROMA_SERVER) {
    return true;
  }
  
  let isValid = true;
  
  if (!serverConfig.CHROMA_PATH) {
    logger.error("  ERROR: 'chroma_path' cannot be empty when Chroma server is enabled.");
    isValid = false;
  } else {
    const absChromaPath = path.resolve(resolvedProjectRoot, serverConfig.CHROMA_PATH);
    logger.info(`  Chroma DB Path: ${serverConfig.CHROMA_PATH} (Resolved: ${absChromaPath})`);
  }
  
  if (!serverConfig.CHROMA_COLLECTION_NAME) {
    logger.error("  ERROR: 'chroma_collection_name' cannot be empty when Chroma server is enabled.");
    isValid = false;
  } else {
    logger.info(`  Chroma Collection Name: ${serverConfig.CHROMA_COLLECTION_NAME}`);
  }
  
  return isValid;
}

export function validateServerConfig(): boolean {
  const hasFilesystemTargets = serverConfig.FILESYSTEM_TARGET_DIRECTORIES.length > 0;
  const hasMemoryServer = serverConfig.ENABLE_MEMORY_SERVER;
  const hasChromaServer = serverConfig.ENABLE_CHROMA_SERVER;
  
  if (!hasFilesystemTargets && !hasMemoryServer && !hasChromaServer) {
    logger.error("  ERROR: No MCP servers are configured. Check 'filesystem_target_directories', 'enable_memory_server', and 'enable_chroma_server'.");
    return false;
  }
  
  return true;
}

// --- Configuration Status Reporting ---
export function logServerConfigStatus(): void {
  const configItems = [
    { name: "Memory Server Enabled", value: serverConfig.ENABLE_MEMORY_SERVER },
    { name: "Chroma Server Enabled", value: serverConfig.ENABLE_CHROMA_SERVER },
    { name: "Chroma Path", value: serverConfig.CHROMA_PATH },
    { name: "Max Debug Log Size", value: serverConfig.MAX_DEBUG_LOG_SIZE },
    { name: "Log Preview Length", value: serverConfig.LOG_PREVIEW_LEN },
  ];
  
  logger.info('--- Server Configuration ---');
  configItems.forEach(item => {
    logger.info(`  ${item.name}: ${item.value}`);
  });
}
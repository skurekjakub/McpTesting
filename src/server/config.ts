import fs from 'fs';
import path, { dirname } from 'path'; // Import dirname
import { fileURLToPath } from 'url'; // Import fileURLToPath
import { z } from 'zod'; // Using Zod for validation
import logger from './logger'; // Import the shared logger

// --- Default Values ---
const DEFAULT_FILESYSTEM_TARGET_DIRECTORIES: string[] = [];
const DEFAULT_ENABLE_MEMORY_SERVER = false;
const DEFAULT_ENABLE_CHROMA_SERVER = true;
const DEFAULT_CHROMA_PATH = './chroma_db';
const DEFAULT_CHROMA_COLLECTION = 'chat_memory';
const DEFAULT_GEMINI_MODEL_FALLBACK = 'gemini-1.5-flash';
const DEFAULT_GENERATION_MODEL_FALLBACK = 'gemini-1.5-flash';
const DEFAULT_SUMMARIZATION_MODEL_FALLBACK = 'gemini-1.5-flash';
const DEFAULT_SUMMARIZATION_THRESHOLD_TOKENS = 16384;
const DEFAULT_MAX_DEBUG_LOG_SIZE = 1500;
const DEFAULT_LOG_PREVIEW_LEN = 250;
const CONFIG_FILENAME = 'config.json';
const BOT_CONFIG_DIR = 'bot_config'; // Relative to project root

// --- Load Configuration from JSON ---
let configData: Record<string, unknown> = {}; // Use Record<string, unknown> instead of any
let configLoadError: string | null = null;

// Calculate project root using ES Module standards
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..'); // Now __dirname is correctly defined
export const resolvedProjectRoot = projectRoot; // Export resolved root path

const configFilePath = path.join(projectRoot, BOT_CONFIG_DIR, CONFIG_FILENAME);

try {
  logger.info(`Attempting to load configuration from: ${configFilePath}`);
  if (fs.existsSync(configFilePath)) {
    const rawData = fs.readFileSync(configFilePath, 'utf-8');
    configData = JSON.parse(rawData);
    logger.info(`Successfully loaded configuration from ${CONFIG_FILENAME}`);
  } else {
    configLoadError = `WARNING: ${CONFIG_FILENAME} not found at ${configFilePath}. Using environment variables and defaults.`;
    logger.warn(configLoadError);
  }
} catch (error: unknown) { // Use unknown instead of any
  if (error instanceof SyntaxError) {
    configLoadError = `ERROR: Could not parse ${CONFIG_FILENAME}: ${error.message}. Using environment variables and defaults.`;
  } else if (error instanceof Error) { // Check if it's an Error instance
    configLoadError = `ERROR: Unexpected error loading ${CONFIG_FILENAME}: ${error.message}. Using environment variables and defaults.`;
  } else {
    configLoadError = `ERROR: Unexpected non-error thrown loading ${CONFIG_FILENAME}: ${String(error)}. Using environment variables and defaults.`;
  }
  logger.error(configLoadError);
}

// --- Define Configuration Schema with Zod ---
const ConfigSchema = z.object({
  GEMINI_API_KEY: z.string().min(1, "Gemini API Key is required."),
  FILESYSTEM_TARGET_DIRECTORIES: z.array(z.string()).default(DEFAULT_FILESYSTEM_TARGET_DIRECTORIES),
  ENABLE_MEMORY_SERVER: z.boolean().default(DEFAULT_ENABLE_MEMORY_SERVER),
  ENABLE_CHROMA_SERVER: z.boolean().default(DEFAULT_ENABLE_CHROMA_SERVER),
  CHROMA_PATH: z.string().default(DEFAULT_CHROMA_PATH),
  CHROMA_COLLECTION_NAME: z.string().default(DEFAULT_CHROMA_COLLECTION),
  DEFAULT_GEMINI_MODEL: z.string().default(DEFAULT_GEMINI_MODEL_FALLBACK),
  GENERATION_GEMINI_MODEL: z.string().default(DEFAULT_GENERATION_MODEL_FALLBACK),
  SUMMARIZATION_MODEL_NAME: z.string().default(DEFAULT_SUMMARIZATION_MODEL_FALLBACK),
  SUMMARIZATION_THRESHOLD_TOKENS: z.number().int().positive().default(DEFAULT_SUMMARIZATION_THRESHOLD_TOKENS),
  MAX_DEBUG_LOG_SIZE: z.number().int().positive().default(DEFAULT_MAX_DEBUG_LOG_SIZE),
  LOG_PREVIEW_LEN: z.number().int().positive().default(DEFAULT_LOG_PREVIEW_LEN),
});

// --- Combine Environment Variables and Config Data ---
const combinedConfig = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || configData.gemini_api_key,
  FILESYSTEM_TARGET_DIRECTORIES: configData.filesystem_target_directories, // Let Zod handle default
  ENABLE_MEMORY_SERVER: configData.enable_memory_server, // Let Zod handle default
  ENABLE_CHROMA_SERVER: configData.enable_chroma_server, // Let Zod handle default
  CHROMA_PATH: configData.chroma_path, // Let Zod handle default
  CHROMA_COLLECTION_NAME: configData.chroma_collection_name, // Let Zod handle default
  DEFAULT_GEMINI_MODEL: configData.default_gemini_model, // Let Zod handle default
  GENERATION_GEMINI_MODEL: configData.generation_gemini_model, // Let Zod handle default
  SUMMARIZATION_MODEL_NAME: configData.summarization_gemini_model, // Let Zod handle default
  SUMMARIZATION_THRESHOLD_TOKENS: configData.summarization_threshold_tokens, // Let Zod handle default
  MAX_DEBUG_LOG_SIZE: configData.max_debug_log_size, // Let Zod handle default
  LOG_PREVIEW_LEN: configData.log_preview_len, // Let Zod handle default
};

// --- Validate and Export Configuration ---
let validatedConfig: z.infer<typeof ConfigSchema>;
let configValid = false;
const validationErrors: string[] = [];

try {
  logger.info("Validating configuration...");
  validatedConfig = ConfigSchema.parse(combinedConfig);

  // Additional custom validations
  if (validatedConfig.GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_GOES_HERE") {
    validationErrors.push("ERROR: Gemini API Key is using a placeholder value. Please replace it.");
  } else {
     logger.info("  Gemini API Key: Loaded (source: ENV or config.json)");
  }

  // Validate filesystem paths if enabled
  if (validatedConfig.FILESYSTEM_TARGET_DIRECTORIES.length > 0) {
     logger.info(`  Filesystem Target Directories (${validatedConfig.FILESYSTEM_TARGET_DIRECTORIES.length}):`);
     let allFsPathsValid = true;
     validatedConfig.FILESYSTEM_TARGET_DIRECTORIES.forEach((dirPath, i) => {
       const absolutePath = path.resolve(projectRoot, dirPath); // Resolve relative paths
       if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
         validationErrors.push(`ERROR: Filesystem directory '${dirPath}' (Resolved: ${absolutePath}) (item #${i + 1}) not found or is not a directory.`);
         allFsPathsValid = false;
       } else {
         logger.info(`    - '${dirPath}' (Resolved: ${absolutePath}) [OK]`);
       }
     });
     if (!allFsPathsValid) {
        // Decide if this should invalidate config
     }
  } else {
      logger.info("  Filesystem Target Directories: None configured.");
  }

  logger.info(`  Enable Memory Server: ${validatedConfig.ENABLE_MEMORY_SERVER}`);
  logger.info(`  Enable Chroma Server: ${validatedConfig.ENABLE_CHROMA_SERVER}`);

  if (validatedConfig.ENABLE_CHROMA_SERVER) {
      if (!validatedConfig.CHROMA_PATH) {
          validationErrors.push("ERROR: 'chroma_path' cannot be empty when Chroma server is enabled.");
      } else {
          const absChromaPath = path.resolve(projectRoot, validatedConfig.CHROMA_PATH);
          logger.info(`  Chroma DB Path: ${validatedConfig.CHROMA_PATH} (Resolved: ${absChromaPath})`);
          // Note: We don't check existence here, Chroma/server should handle creation
      }
      if (!validatedConfig.CHROMA_COLLECTION_NAME) {
          validationErrors.push("ERROR: 'chroma_collection_name' cannot be empty when Chroma server is enabled.");
      } else {
           logger.info(`  Chroma Collection Name: ${validatedConfig.CHROMA_COLLECTION_NAME}`);
      }
  }

  // Check if at least one server type is configured/enabled
  if (
    validatedConfig.FILESYSTEM_TARGET_DIRECTORIES.length === 0 &&
    !validatedConfig.ENABLE_MEMORY_SERVER &&
    !validatedConfig.ENABLE_CHROMA_SERVER
  ) {
    validationErrors.push(
      "ERROR: No MCP servers are configured. Check 'filesystem_target_directories', 'enable_memory_server', and 'enable_chroma_server'."
    );
  }

  // Log other values
  logger.info(`  Default Gemini Model: ${validatedConfig.DEFAULT_GEMINI_MODEL}`);
  logger.info(`  Generation Gemini Model: ${validatedConfig.GENERATION_GEMINI_MODEL}`);
  logger.info(`  Summarization Model: ${validatedConfig.SUMMARIZATION_MODEL_NAME}`);
  logger.info(`  Summarization Threshold: ${validatedConfig.SUMMARIZATION_THRESHOLD_TOKENS} tokens`);
  logger.info(`  Max Debug Log Size: ${validatedConfig.MAX_DEBUG_LOG_SIZE}`);
  logger.info(`  Log Preview Length: ${validatedConfig.LOG_PREVIEW_LEN}`);


  if (validationErrors.length === 0) {
    configValid = true;
    logger.info("--- Configuration validation passed. ---");
  } else {
    logger.error("--- Configuration errors detected: ---");
    validationErrors.forEach(err => logger.error(`  - ${err}`));
    logger.error("--- Application might not function correctly. ---");
    // Optionally exit if config is invalid and critical
    // process.exit(1);
  }

} catch (error: unknown) { // Use unknown instead of any
  if (error instanceof z.ZodError) {
    logger.error("--- Configuration validation failed (Zod): ---");
    error.errors.forEach(err => {
      logger.error(`  - Path: ${err.path.join('.') || '<root>'}, Message: ${err.message}`);
      validationErrors.push(`Validation Error (${err.path.join('.') || '<root>'}): ${err.message}`);
    });
  } else if (error instanceof Error) { // Check if it's an Error instance
    logger.error("--- Unexpected error during configuration validation: ---", error);
     validationErrors.push(`Unexpected Validation Error: ${error.message}`);
  } else {
    logger.error("--- Unexpected non-error thrown during configuration validation: ---", error);
    validationErrors.push(`Unexpected Validation Error: ${String(error)}`);
  }
  logger.error("--- Application might not function correctly. ---");
  // Set validatedConfig to defaults on error to prevent downstream crashes? Or throw?
  // For now, let it be potentially undefined or partially defined.
  validatedConfig = ConfigSchema.parse({}); // Attempt to get defaults
}

// Export the validated config and status
export const config = validatedConfig;
export const isConfigValid = configValid;
export const configValidationErrors = validationErrors;

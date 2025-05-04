// src/server/llm/gemini/client.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../../logger'; // Adjust path
import { llmConfig } from '../../config/llm'; // Import directly from llm config module
import { validateConfig } from '../../config'; // Import the validation function

let geminiClientInstance: GoogleGenerativeAI | null = null;

/**
 * Initializes the shared GoogleGenerativeAI client instance.
 * Should be called once during application startup.
 */
export function initializeGeminiClient(): GoogleGenerativeAI | null {
    const isConfigValid = validateConfig();
    if (!isConfigValid || !llmConfig?.GEMINI_API_KEY) {
        logger.warn('[Gemini Client] Skipping Gemini client initialization due to invalid config or missing API key.');
        return null;
    }
    if (geminiClientInstance) {
        logger.warn('[Gemini Client] Gemini client already initialized.');
        return geminiClientInstance;
    }

    try {
        logger.info('[Gemini Client] Initializing Gemini client...');
        geminiClientInstance = new GoogleGenerativeAI(llmConfig.GEMINI_API_KEY);
        logger.info('[Gemini Client] Gemini client initialized successfully.');
        return geminiClientInstance;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[Gemini Client] ERROR: Error initializing Gemini client: ${message}`);
        geminiClientInstance = null;
        return null;
    }
}

/**
 * Gets the initialized GoogleGenerativeAI client instance.
 * Throws an error if the client has not been initialized.
 */
export function getGeminiClient(): GoogleGenerativeAI {
    if (!geminiClientInstance) {
        logger.error('[Gemini Client] Attempted to use Gemini client before it was initialized!');
        throw new Error('Gemini client not initialized');
    }
    return geminiClientInstance;
}

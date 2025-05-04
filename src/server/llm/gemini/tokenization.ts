// src/server/llm/gemini/tokenization.ts
import {
    Content,
    CountTokensResponse
} from '@google/generative-ai';
import logger from '../../logger'; // Adjust path
import { llmConfig } from '../../config/llm'; // Import directly from llm config module
import { getGeminiClient } from './client'; // Import from sibling

// Helper to get the model used for token counting (usually the generation model)
function getTokenCountingModel() {
    const client = getGeminiClient();
    // Use the generation model for counting unless a specific counting model is defined
    const modelName = llmConfig.GENERATION_GEMINI_MODEL || llmConfig.DEFAULT_GEMINI_MODEL;
    if (!modelName) {
        throw new Error('No Gemini model configured for token counting.');
    }
    return client.getGenerativeModel({ model: modelName });
}

/**
 * Counts tokens for the given text.
 */
export async function countTokensForText(text: string): Promise<number> {
    const model = getTokenCountingModel();
    try {
        const result: CountTokensResponse = await model.countTokens(text);
        return result.totalTokens;
    } catch (error: any) {
        logger.warn(`[Gemini Tokenization] Failed to count tokens for text: ${error?.message}`);
        return 0;
    }
}

/**
 * Counts tokens for the given conversation history.
 */
export async function countTokensForHistory(history: Content[]): Promise<number> {
    const model = getTokenCountingModel();
    try {
        const result: CountTokensResponse = await model.countTokens({ contents: history });
        return result.totalTokens;
    } catch (error: any) {
        logger.warn(`[Gemini Tokenization] Failed to count tokens for history: ${error?.message}`);
        return 0;
    }
}

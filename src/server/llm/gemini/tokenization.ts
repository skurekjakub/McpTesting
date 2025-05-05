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
 * Now handles potentially scored messages by sanitizing them first.
 */
export async function countTokensForHistory(history: Content[]): Promise<number> {
    if (!history || history.length === 0) {
        return 0;
    }
    
    const model = getTokenCountingModel();
    try {
        // Check if we need to sanitize the history (if it has importanceScore or other extra props)
        const needsSanitization = history.some(msg => 
            Object.keys(msg).some(key => key !== 'role' && key !== 'parts')
        );
        
        // Use sanitized history for token counting if needed
        const historyForCounting = needsSanitization ? 
            history.map(msg => ({
                role: msg.role,
                parts: msg.parts.map(part => ({...part}))
            })) : 
            history;
        
        // Count tokens with sanitized history
        const result: CountTokensResponse = await model.countTokens({ contents: historyForCounting });
        
        // Log the actual token count for debugging
        if (needsSanitization) {
            logger.debug(`[Gemini Tokenization] Counted tokens from sanitized history: ${result.totalTokens}`);
        }
        
        return result.totalTokens;
    } catch (error: any) {
        logger.warn(`[Gemini Tokenization] Failed to count tokens for history: ${error?.message}`);
        // Try a fallback method if available, otherwise return approximate count
        // For now, return a non-zero estimate to prevent false "summarization success"
        return history.reduce((sum, msg) => {
            // Get text content and estimate roughly 1.5 tokens per word
            const text = msg.parts
                .map(part => typeof part === 'object' && 'text' in part ? part.text : '')
                .join('');
            return sum + Math.ceil(text.split(/\s+/).length * 1.5);
        }, 100); // Start with base token count for message structure
    }
}

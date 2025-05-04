// src/server/llm/gemini/summarization.ts
import {
    GoogleGenerativeAI,
    GenerativeModel,
    Content
} from '@google/generative-ai';
import logger from '../../logger'; // Adjust path
import { config } from '../../config'; // Adjust path
import { getGeminiClient } from './client'; // Import from sibling
import { extractTextFromResult } from './parsing'; // Correct the import path for parsing functions

/**
 * Summarizes a given portion of the conversation history.
 */
export async function summarizeHistory(historyToSummarize: Content[]): Promise<string | null> {
    if (!config.SUMMARIZATION_MODEL_NAME) {
        logger.warn('[Gemini Summarization] Summarization model name is not configured. Skipping summarization.');
        return null;
    }
    if (historyToSummarize.length === 0) {
        logger.info('[Gemini Summarization] No history provided to summarize.');
        return null;
    }

    const client = getGeminiClient();
    const summarizationModel = client.getGenerativeModel({
        model: config.SUMMARIZATION_MODEL_NAME,
    });

    const summarizationPrompt: Content[] = [
        ...historyToSummarize,
        {
            role: 'user',
            parts: [{ text: 'Please summarize the preceding conversation concisely, capturing the key topics and decisions made. Focus on information relevant for continuing the conversation. Respond ONLY with the summary text.' }]
        }
    ];

    logger.info(`[Gemini Summarization] Requesting summarization using model: ${config.SUMMARIZATION_MODEL_NAME}`);

    try {
        const result = await summarizationModel.generateContent({ contents: summarizationPrompt });
        const summaryText = extractTextFromResult(result); // Will be imported from parsing.ts

        if (!summaryText) {
            logger.warn('[Gemini Summarization] Summarization model returned an empty response.');
            return null;
        }

        logger.info(`[Gemini Summarization] Summarization successful (${summaryText.length} chars).`);
        return summaryText;
    } catch (error: any) {
        logger.error(`[Gemini Summarization] Error during history summarization: ${error?.message}`, error);
        return null;
    }
}

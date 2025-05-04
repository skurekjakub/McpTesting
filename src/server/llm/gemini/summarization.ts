// src/server/llm/gemini/summarization.ts
import {
    GoogleGenerativeAI,
    GenerativeModel,
    Content
} from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../../logger'; // Adjust path
import { config } from '../../config'; // Adjust path
import { getGeminiClient } from './client'; // Import from sibling
import { extractTextFromResult } from './parsing'; // Correct the import path for parsing functions

/**
 * Default system prompt for summarization when no custom prompt is provided.
 */
const DEFAULT_SUMMARIZATION_SYSTEM_PROMPT = `You are an expert AI conversation summarizer with the following responsibilities:

1. Create concise, information-dense summaries of conversations between a human and an AI assistant
2. Preserve key contextual information that would be necessary for continuing the conversation 
3. Maintain important details about:
   - User goals and objectives
   - Decisions that were made
   - Questions that were asked and their answers
   - Tasks that were completed or are in progress
   - Important code snippets or technical details mentioned
   - Any unresolved issues or pending actions
4. Remove redundant or unnecessary information
5. Format the summary in clear, readable text optimized for an AI to understand context
6. Never include meta-commentary about the summarization process itself

The summary will be used as context for an AI assistant to continue the conversation, so focus on details that enable seamless continuation.`;

/**
 * Loads the summarization system prompt from the config file if it exists,
 * otherwise returns the default prompt.
 */
function loadSummarizationSystemPrompt(): string {
    const configFilePath = path.resolve(process.cwd(), 'bot_config', 'system-instruction-summarizer.md');
    
    try {
        if (fs.existsSync(configFilePath)) {
            const customPrompt = fs.readFileSync(configFilePath, 'utf8');
            logger.info('[Gemini Summarization] Loaded custom summarization system prompt from config file');
            return customPrompt;
        }
    } catch (error: any) {
        logger.warn(`[Gemini Summarization] Error loading custom summarization prompt: ${error?.message}. Using default prompt.`);
    }
    
    logger.info('[Gemini Summarization] Using default summarization system prompt');
    return DEFAULT_SUMMARIZATION_SYSTEM_PROMPT;
}

// Load the system prompt when the module initializes
const SUMMARIZATION_SYSTEM_PROMPT = loadSummarizationSystemPrompt();

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
        {
            role: 'model',
            parts: [{ text: SUMMARIZATION_SYSTEM_PROMPT }]
        },
        ...historyToSummarize,
        {
            role: 'user',
            parts: [{ text: 'Please summarize the preceding conversation concisely. Focus only on information that would be relevant for continuing the conversation effectively.' }]
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

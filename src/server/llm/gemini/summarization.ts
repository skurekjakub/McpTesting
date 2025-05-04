// src/server/llm/gemini/summarization.ts
import {
    GoogleGenerativeAI,
    GenerativeModel,
    Content
} from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../../logger'; // Adjust path
import { llmConfig } from '../../config/llm'; // Import directly from llm config module
import { agentConfig } from '../../config/agent'; // Import directly from agent config module
import { resolvedProjectRoot } from '../../config/base'; // Import project root from base config
import { getGeminiClient } from './client'; // Import from sibling
import { extractTextFromResult } from './parsing'; // Correct the import path for parsing functions
import { countTokensForText, countTokensForHistory } from './tokenization'; // Import tokenization utility

// Cost efficiency settings
const COST_EFFICIENT_SETTINGS = {
    // Keep this many recent messages intact without summarization
    RECENT_MESSAGES_TO_PRESERVE: agentConfig.RECENT_MESSAGES_TO_PRESERVE,
    // Threshold for aggressive summarization of older content (token count)
    DEEP_HISTORY_THRESHOLD: agentConfig.DEEP_HISTORY_THRESHOLD,
    // How much to target reducing the token count (higher = more cost savings, lower = better context)
    TARGET_COMPRESSION_RATIO: agentConfig.TARGET_COMPRESSION_RATIO,
};

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
    const configFilePath = path.resolve(
        resolvedProjectRoot,
        agentConfig.SYSTEM_INSTRUCTION_DIRECTORY, 
        agentConfig.SUMMARIZER_INSTRUCTION_FILENAME
    );
    
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
 * Progressive summarization approach that optimizes for cost efficiency
 * by applying different summarization strategies based on content age and importance.
 */
export async function summarizeHistoryCostOptimized(historyToSummarize: Content[]): Promise<Content[]> {
    if (historyToSummarize.length <= COST_EFFICIENT_SETTINGS.RECENT_MESSAGES_TO_PRESERVE) {
        logger.info('[Gemini Summarization] History too small for summarization, returning as-is');
        return historyToSummarize;
    }

    // Keep recent messages intact
    const recentMessages = historyToSummarize.slice(-COST_EFFICIENT_SETTINGS.RECENT_MESSAGES_TO_PRESERVE);
    
    // Summarize older history
    const olderHistory = historyToSummarize.slice(0, -COST_EFFICIENT_SETTINGS.RECENT_MESSAGES_TO_PRESERVE);
    
    // Calculate token count to determine summarization approach
    const estimatedTokens = await countTokensForHistory(olderHistory);

    let summarizedOlderContent: Content[];
    
    if (estimatedTokens > COST_EFFICIENT_SETTINGS.DEEP_HISTORY_THRESHOLD) {
        // Use more aggressive summarization for very long histories
        logger.info(`[Gemini Summarization] Using aggressive summarization for ${estimatedTokens} tokens of older history`);
        const summaryText = await summarizeHistory(olderHistory, 'aggressive');
        summarizedOlderContent = summaryText ? [
            { role: 'model', parts: [{ text: `CONVERSATION SUMMARY: ${summaryText}` }] }
        ] : [];
    } else {
        // Use standard summarization for moderate histories
        logger.info(`[Gemini Summarization] Using standard summarization for ${estimatedTokens} tokens of older history`);
        const summaryText = await summarizeHistory(olderHistory, 'standard');
        summarizedOlderContent = summaryText ? [
            { role: 'model', parts: [{ text: `CONVERSATION SUMMARY: ${summaryText}` }] }
        ] : [];
    }
    
    // Return the summarized older content + intact recent messages
    return [...summarizedOlderContent, ...recentMessages];
}

/**
 * Summarizes a given portion of the conversation history.
 * @param historyToSummarize The conversation history to summarize
 * @param mode The summarization mode - 'standard' or 'aggressive'
 */
export async function summarizeHistory(
    historyToSummarize: Content[],
    mode: 'standard' | 'aggressive' = 'standard'
): Promise<string | null> {
    if (!llmConfig.SUMMARIZATION_MODEL_NAME) {
        logger.warn('[Gemini Summarization] Summarization model name is not configured. Skipping summarization.');
        return null;
    }
    if (historyToSummarize.length === 0) {
        logger.info('[Gemini Summarization] No history provided to summarize.');
        return null;
    }

    const client = getGeminiClient();
    
    // Use a smaller, cheaper model for summarization if cost optimization is critical
    const modelToUse = mode === 'aggressive' && llmConfig.COST_EFFICIENT_SUMMARIZATION_MODEL 
        ? llmConfig.COST_EFFICIENT_SUMMARIZATION_MODEL 
        : llmConfig.SUMMARIZATION_MODEL_NAME;
        
    const summarizationModel = client.getGenerativeModel({
        model: modelToUse,
    });

    // Adjust instruction based on summarization mode
    const summaryInstruction = mode === 'aggressive' 
        ? 'Please create an extremely concise summary of the preceding conversation, focusing only on the most essential information needed to maintain context. Prioritize brevity over completeness.'
        : 'Please summarize the preceding conversation concisely. Focus only on information that would be relevant for continuing the conversation effectively.';

    const summarizationPrompt: Content[] = [
        {
            role: 'model',
            parts: [{ text: SUMMARIZATION_SYSTEM_PROMPT }]
        },
        ...historyToSummarize,
        {
            role: 'user',
            parts: [{ text: summaryInstruction }]
        }
    ];

    logger.info(`[Gemini Summarization] Requesting ${mode} summarization using model: ${modelToUse}`);

    try {
        const result = await summarizationModel.generateContent({ 
            contents: summarizationPrompt,
            // Add temperature adjustment for more concise summaries when in aggressive mode
            generationConfig: mode === 'aggressive' ? { temperature: 0.2 } : undefined
        });
        const summaryText = extractTextFromResult(result);

        if (!summaryText) {
            logger.warn('[Gemini Summarization] Summarization model returned an empty response.');
            return null;
        }

        const originalTokenEstimate = await countTokensForHistory(historyToSummarize);
        const summaryTokenEstimate = await countTokensForText(summaryText);
        const compressionRatio = summaryTokenEstimate / (originalTokenEstimate || 1);
        
        logger.info(`[Gemini Summarization] ${mode} summarization successful (${summaryText.length} chars, compression ratio: ${compressionRatio.toFixed(2)})`);
        return summaryText;
    } catch (error: any) {
        logger.error(`[Gemini Summarization] Error during history summarization: ${error?.message}`, error);
        return null;
    }
}

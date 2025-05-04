// src/server/llm/gemini/generation.ts
import {
    GenerativeModel,
    Content,
    Tool,
    GenerateContentRequest,
    GenerateContentResult,
    SafetySetting,
    GenerationConfig
} from '@google/generative-ai';
import logger from '../../logger'; // Adjust path
import { llmConfig } from '../../config/llm'; // Import directly from llm config module
import { getGeminiClient } from './client'; // Import from sibling

// Interface for generation options (can be moved to a shared types file later)
interface GenerateOptions {
    history: Content[];
    tools?: Tool[];
    safetySettings?: SafetySetting[];
    generationConfig?: GenerationConfig;
    systemInstructionText?: string;
}

function getGenerationModel(systemInstructionText?: string): GenerativeModel {
    const client = getGeminiClient();
    if (!llmConfig.GENERATION_GEMINI_MODEL) {
        throw new Error('Generation Gemini model name is not configured.');
    }
    return client.getGenerativeModel({
        model: llmConfig.GENERATION_GEMINI_MODEL,
        ...(systemInstructionText && { systemInstruction: { role: 'system', parts: [{ text: systemInstructionText }] } })
    });
}

/**
 * Generates content using the configured generation model and tools.
 */
export async function generateContentWithTools(
    options: GenerateOptions
): Promise<GenerateContentResult> {
    const model = getGenerationModel(options.systemInstructionText);
    const request: GenerateContentRequest = {
        contents: options.history,
        ...(options.tools && options.tools.length > 0 && { tools: options.tools }),
        ...(options.safetySettings && { safetySettings: options.safetySettings }),
        ...(options.generationConfig && { generationConfig: options.generationConfig }),
    };

    logger.info('[Gemini Generation] Sending request to Gemini...', {
        historyLength: options.history.length,
        toolCount: options.tools?.length ?? 0,
    });

    try {
        const result = await model.generateContent(request);
        logger.info('[Gemini Generation] Received response from Gemini.');
        if (!result?.response) {
             logger.error('[Gemini Generation] Gemini response or response field was missing.');
             throw new Error('Invalid response structure from Gemini API');
        }
        return result;
    } catch (error: any) {
        logger.error(`[Gemini Generation] Error during generateContent call: ${error?.message}`, error);
        throw error;
    }
}

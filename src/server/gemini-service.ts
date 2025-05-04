// src/server/gemini-service.ts
import {
    GoogleGenerativeAI,
    GenerativeModel,
    Content,
    Tool,
    GenerateContentRequest,
    GenerateContentResult,
    CountTokensRequest,
    CountTokensResponse,
    SafetySetting,
    GenerationConfig,
    FinishReason,
    GenerateContentResponse
} from '@google/generative-ai';
import logger from './logger';
import { config, isConfigValid } from './config'; // Import isConfigValid

let geminiClientInstance: GoogleGenerativeAI | null = null;

// Export an initialization function
export function initializeGeminiClient(): GoogleGenerativeAI | null {
    if (!isConfigValid || !config?.GEMINI_API_KEY) {
        logger.warn('[GeminiService] Skipping Gemini client initialization due to invalid config or missing API key.');
        return null;
    }
    if (geminiClientInstance) {
        logger.warn('[GeminiService] Gemini client already initialized.');
        return geminiClientInstance;
    }

    try {
        logger.info('[GeminiService] Initializing Gemini client...');
        geminiClientInstance = new GoogleGenerativeAI(config.GEMINI_API_KEY);
        logger.info('[GeminiService] Gemini client initialized successfully.');
        return geminiClientInstance;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[GeminiService] ERROR: Error initializing Gemini client: ${message}`);
        geminiClientInstance = null; // Ensure it's null on error
        return null;
    }
}

function getClient(): GoogleGenerativeAI {
    if (!geminiClientInstance) {
        // This should ideally not happen if initialization is done correctly
        logger.error('[GeminiService] Attempted to use Gemini client before it was initialized!');
        throw new Error('Gemini client not initialized');
    }
    return geminiClientInstance;
}

function getModel(systemInstructionText?: string): GenerativeModel {
    const client = getClient();
    if (!config.GENERATION_GEMINI_MODEL) {
        throw new Error('Generation Gemini model name is not configured.');
    }
    return client.getGenerativeModel({
        model: config.GENERATION_GEMINI_MODEL,
        ...(systemInstructionText && { systemInstruction: { role: 'system', parts: [{ text: systemInstructionText }] } })
        // Tools, safety, and generation config are applied per-request in generateContent
    });
}

interface GenerateOptions {
    history: Content[];
    tools?: Tool[];
    safetySettings?: SafetySetting[];
    generationConfig?: GenerationConfig;
    systemInstructionText?: string;
}

/**
 * Generates content using the Gemini API.
 */
export async function generateContentWithTools(
    options: GenerateOptions
): Promise<GenerateContentResult> {
    const model = getModel(options.systemInstructionText);
    const request: GenerateContentRequest = {
        contents: options.history,
        ...(options.tools && options.tools.length > 0 && { tools: options.tools }),
        ...(options.safetySettings && { safetySettings: options.safetySettings }),
        ...(options.generationConfig && { generationConfig: options.generationConfig }),
    };

    logger.info('[GeminiService] Sending request to Gemini...', {
        historyLength: options.history.length,
        toolCount: options.tools?.length ?? 0,
    });

    try {
        const result = await model.generateContent(request);
        logger.info('[GeminiService] Received response from Gemini.');
        // Basic validation before returning
        if (!result?.response) {
             logger.error('[GeminiService] Gemini response or response field was missing.');
             throw new Error('Invalid response structure from Gemini API');
        }
        return result;
    } catch (error: any) {
        logger.error(`[GeminiService] Error during generateContent call: ${error?.message}`, error);
        // Re-throw or handle specific errors as needed
        throw error;
    }
}

/**
 * Counts tokens for the given text using the configured generation model.
 */
export async function countTokensForText(text: string): Promise<number> {
    // Use the same model used for generation for consistency
    const model = getModel();
    try {
        const result: CountTokensResponse = await model.countTokens(text);
        return result.totalTokens;
    } catch (error: any) {
        logger.warn(`[GeminiService] Failed to count tokens: ${error?.message}`);
        return 0; // Return 0 or throw, depending on desired handling
    }
}

/**
 * Counts tokens for the given conversation history using the configured generation model.
 */
export async function countTokensForHistory(history: Content[]): Promise<number> {
    // Use the same model used for generation for consistency
    const model = getModel();
    try {
        const result: CountTokensResponse = await model.countTokens({ contents: history });
        return result.totalTokens;
    } catch (error: any) {
        logger.warn(`[GeminiService] Failed to count tokens for history: ${error?.message}`);
        return 0; // Return 0 or throw, depending on desired handling
    }
}

/**
 * Extracts the primary text content from a Gemini response.
 */
export function extractTextFromResult(result: GenerateContentResult): string {
    try {
        // Use the built-in text() method if available
        const text = result.response.text?.();
        if (text !== undefined) {
            return text;
        }
        // Fallback: concatenate text parts if text() is not available or empty
        const candidate = result.response.candidates?.[0];
        if (candidate?.content?.parts) {
            return candidate.content.parts.map(part => part.text ?? '').join('');
        }
    } catch (error: any) {
        logger.error(`[GeminiService] Error extracting text from result: ${error?.message}`, result);
    }
    return ''; // Return empty string if extraction fails
}

/**
 * Extracts the first function call from a Gemini response, if any.
 */
export function extractFunctionCallFromResult(result: GenerateContentResult): Readonly<({ name: string; args: object; })> | undefined {
     try {
        const candidate = result.response.candidates?.[0];
        const functionCallPart = candidate?.content?.parts?.find(part => !!part.functionCall);
        return functionCallPart?.functionCall;
    } catch (error: any) {
        logger.error(`[GeminiService] Error extracting function call from result: ${error?.message}`, result);
    }
    return undefined;
}

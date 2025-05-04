// src/server/llm/gemini/parsing.ts
import {
    GenerateContentResult,
    Part
} from '@google/generative-ai';
import logger from '../../logger'; // Adjust path

/**
 * Extracts the primary text content from a Gemini response.
 */
export function extractTextFromResult(result: GenerateContentResult): string {
    try {
        const text = result.response.text?.();
        if (text !== undefined) {
            return text;
        }
        const candidate = result.response.candidates?.[0];
        if (candidate?.content?.parts) {
            return candidate.content.parts.map(part => part.text ?? '').join('');
        }
    } catch (error: any) {
        logger.error(`[Gemini Parsing] Error extracting text from result: ${error?.message}`, result);
    }
    return '';
}

/**
 * Extracts the first function call from a Gemini response, if any.
 */
export function extractFunctionCallFromResult(result: GenerateContentResult): Readonly<({ name: string; args: object; })> | undefined {
     try {
        const candidate = result.response.candidates?.[0];
        const functionCallPart = candidate?.content?.parts?.find((part: Part) => !!part.functionCall);
        return functionCallPart?.functionCall;
    } catch (error: any) {
        logger.error(`[Gemini Parsing] Error extracting function call from result: ${error?.message}`, result);
    }
    return undefined;
}

// Create file: c:/projects/python/mcpbro/mcpbro-nextjs/src/server/chat-processor.ts
import {
  Content,
  Part,
  FunctionResponsePart,
  Tool,
  HarmCategory,
  HarmBlockThreshold,
  FinishReason,
  FunctionDeclarationsTool,
} from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

import { config, isConfigValid, resolvedProjectRoot } from './config';
import { discoverAndFormatTools, handleFunctionCall } from './tools/mcp/mcp-tool-handler';
import logger from './logger';
// Import from specific submodules
import { generateContentWithTools } from './llm/gemini/generation';
import { countTokensForText, countTokensForHistory } from './llm/gemini/tokenization';
import { extractTextFromResult, extractFunctionCallFromResult } from './llm/gemini/parsing';
import { summarizeHistory } from './llm/gemini/summarization';

// --- Constants ---
const MAX_FUNCTION_CALLS_PER_TURN = 25; // Same as Python version
const SYSTEM_INSTRUCTION_FILENAME = 'system_instruction.md';
const BOT_CONFIG_DIR = 'bot_config'; // Relative to project root
const MESSAGES_TO_KEEP_UNSUMMARIZED = 6; // Keep last N messages out of summary

// --- Load System Instruction ---
let systemInstruction = 'Default system instruction if file loading fails.'; // Fallback
const systemInstructionPath = path.join(resolvedProjectRoot, BOT_CONFIG_DIR, SYSTEM_INSTRUCTION_FILENAME);
try {
  if (fs.existsSync(systemInstructionPath)) {
    systemInstruction = fs.readFileSync(systemInstructionPath, 'utf-8').trim();
    logger.info(`Successfully loaded system instruction from ${systemInstructionPath}`);
  } else {
    logger.warn(`System instruction file not found at ${systemInstructionPath}. Using default.`);
  }
} catch (error: unknown) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  logger.error(`Error loading system instruction from ${systemInstructionPath}: ${errorMsg}. Using default.`);
}

// --- Type Definitions ---
// Callback for internal steps (optional)
type InternalStepCallback = (message: string) => void;

// --- Type Guard ---
function isFunctionDeclarationsTool(tool: Tool): tool is FunctionDeclarationsTool {
  return (tool as FunctionDeclarationsTool).functionDeclarations !== undefined;
}

// --- Core Async Prompt Processing Logic ---

/**
 * Processes user prompt, orchestrates Gemini calls and tool execution.
 * @param userPrompt The new prompt from the user.
 * @param history The existing internal conversation history (list of Content objects).
 * @param internalStepCallback An optional function to call for emitting internal status updates.
 * @returns A tuple containing the final text response and the updated history.
 */
export async function processPrompt(
  userPrompt: string,
  history: Content[],
  internalStepCallback?: InternalStepCallback
): Promise<[string, Content[]]> {
  const logStep = (message: string, details?: any) => {
    logger.info(`[ChatProcessor] ${message}`, details ?? '');
    internalStepCallback?.(message);
  };

  let finalResponseText = 'Error: Processing failed to produce a response.';
  const currentTurnHistory: Content[] = [...history];
  let availableTools: Tool[] = []; // Declare availableTools in the outer scope

  // --- Prepare Initial History, Discover Tools, MANAGE HISTORY --- 
  try {
    logStep(`Processing prompt: '${userPrompt.substring(0, 100)}${userPrompt.length > 100 ? '...' : ''}'`);
    const userPart: Part = { text: userPrompt };
    currentTurnHistory.push({ role: 'user', parts: [userPart] });

    // --- History Management (Summarization) ---
    const currentTokenCount = await countTokensForHistory(currentTurnHistory);
    logStep(`Token count before generation: ${currentTokenCount}`);

    if (currentTokenCount > config.SUMMARIZATION_THRESHOLD_TOKENS) {
      logStep(`History token count (${currentTokenCount}) exceeds threshold (${config.SUMMARIZATION_THRESHOLD_TOKENS}). Attempting summarization.`);

      // Determine which messages to summarize (keep first user message, summarize middle, keep last N)
      const firstUserMessageIndex = 0; // Assuming first message is always user
      const startIndexToSummarize = firstUserMessageIndex + 1;
      const endIndexToSummarize = Math.max(startIndexToSummarize, currentTurnHistory.length - MESSAGES_TO_KEEP_UNSUMMARIZED);

      if (endIndexToSummarize > startIndexToSummarize) {
        const historyToSummarize = currentTurnHistory.slice(startIndexToSummarize, endIndexToSummarize);
        const summaryText = await summarizeHistory(historyToSummarize);

        if (summaryText) {
          // Create the summary message
          const summaryMessage: Content = {
            role: 'model', // Or consider 'system' if supported/appropriate
            parts: [{ text: `Summary of earlier conversation:
${summaryText}` }]
          };

          // Replace the summarized section with the summary message
          currentTurnHistory.splice(startIndexToSummarize, historyToSummarize.length, summaryMessage);

          const newTokenCount = await countTokensForHistory(currentTurnHistory);
          logStep(`History summarized. New token count: ${newTokenCount}`);
        } else {
          logStep('Summarization failed or returned empty. Proceeding with original history (truncation might occur later).');
        }
      } else {
        logStep('Not enough messages to summarize between first and last few.');
      }
    } // End of summarization check

    // --- Tool Discovery ---
    logStep('Discovering tools...');
    availableTools = await discoverAndFormatTools(); // Assign to the outer scope variable
    const functionTool = availableTools.find(isFunctionDeclarationsTool);
    const declarationCount = functionTool?.functionDeclarations?.length ?? 0;
    logStep(`Discovered ${declarationCount} function declarations for this turn.`);

  } catch (error: unknown) {
    logger.error('[ChatProcessor] Error during initial setup, history management, or tool discovery.', error);
    return ['Error preparing request.', history];
  }

  // --- Main Processing Loop ---
  let functionCallCount = 0;
  let safetyBypass = false;

  while (functionCallCount < MAX_FUNCTION_CALLS_PER_TURN) {
    const iteration = functionCallCount + 1;
    logStep(`--- Starting API Call Loop Iteration ${iteration} ---`);

    try {
      const generationConfig = {
        temperature: 0.7,
      };
      const safetySettings: Array<{ category: HarmCategory; threshold: HarmBlockThreshold }> = [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      ];

      const result = await generateContentWithTools({
        history: currentTurnHistory,
        tools: availableTools,
        safetySettings: safetyBypass ? undefined : safetySettings,
        generationConfig,
        systemInstructionText: systemInstruction,
      });

      const response = result.response;
      const candidate = response.candidates?.[0];

      if (!candidate) {
        const feedback = response.promptFeedback;
        logger.error('[ChatProcessor] Gemini response had no candidates.', { feedback });
        finalResponseText = `Error: Gemini returned no candidates. ${feedback?.blockReason ? `Reason: ${feedback.blockReason}` : ''}`;
        currentTurnHistory.push({ role: 'model', parts: [{ text: finalResponseText }] });
        break;
      }

      if (candidate.content) {
        const partSummary = candidate.content.parts
          .map((p: Part) =>
            p.functionCall ? `FunctionCall(${p.functionCall.name})` : p.text ? `Text(${p.text.length} chars)` : 'EmptyPart'
          )
          .join(', ');
        logger.info(`[ChatProcessor] Adding Gemini response part to history: Role=${candidate.content.role}, Parts=[${partSummary}]`);
        currentTurnHistory.push(candidate.content);
      } else {
        logger.warn('[ChatProcessor] Gemini candidate had no content part.');
      }

      const call = extractFunctionCallFromResult(result);

      if (call) {
        functionCallCount++;
        logStep(`Gemini requested function call #${functionCallCount}: ${call.name}`);
        safetyBypass = true;

        const toolResponsePayload = await handleFunctionCall(call);
        const functionResponsePart: FunctionResponsePart = { functionResponse: toolResponsePayload };
        currentTurnHistory.push({ role: 'function', parts: [functionResponsePart] });
        logger.info(`[ChatProcessor] Added function response for ${call.name} to history.`);
      } else {
        logStep('No function call requested. Processing final response.');
        safetyBypass = false;

        const finishReason = candidate.finishReason;
        if (finishReason && [FinishReason.STOP, FinishReason.MAX_TOKENS].includes(finishReason)) {
          finalResponseText = extractTextFromResult(result);

          const tokenCount = await countTokensForText(finalResponseText);
          logStep(`Gemini finish reason: ${finishReason}. Final text generated (${tokenCount} tokens).`);

          if (finishReason === FinishReason.MAX_TOKENS) {
            logger.warn('[ChatProcessor] Gemini response may be truncated due to MAX_TOKENS finish reason.');
            finalResponseText += '\n\n(Warning: Response may be truncated due to maximum token limit.)';
          }
        } else {
          logger.error(`[ChatProcessor] Unexpected finish reason: ${finishReason}.`, { content: candidate.content });
          finalResponseText = `Error: Unexpected response state from model (Finish Reason: ${finishReason}).`;
        }

        const lastHistoryItem = currentTurnHistory[currentTurnHistory.length - 1];
        if (
          lastHistoryItem?.role !== 'model' ||
          lastHistoryItem.parts.map((p: Part) => p.text ?? '').join('') !== finalResponseText
        ) {
          logger.info('[ChatProcessor] Adding final model text response to history.');
          currentTurnHistory.push({ role: 'model', parts: [{ text: finalResponseText }] });
        }
        break;
      }
    } catch (error: unknown) {
      logger.error('[ChatProcessor] Error during Gemini processing loop.', error);
      finalResponseText = `An unexpected server error occurred: ${error instanceof Error ? error.message : String(error)}`;
      currentTurnHistory.push({ role: 'model', parts: [{ text: finalResponseText }] });
      break;
    }
  }

  if (functionCallCount >= MAX_FUNCTION_CALLS_PER_TURN) {
    logger.error(`[ChatProcessor] Reached maximum function call limit (${MAX_FUNCTION_CALLS_PER_TURN}).`);
    finalResponseText = `Error: Reached maximum tool call limit (${MAX_FUNCTION_CALLS_PER_TURN}). The request could not be fully completed.`;
    currentTurnHistory.push({ role: 'model', parts: [{ text: finalResponseText }] });
  }

  if (currentTurnHistory.length > 1) {
    const last = currentTurnHistory[currentTurnHistory.length - 1];
    const secondLast = currentTurnHistory[currentTurnHistory.length - 2];
    if (
      last.role === 'model' &&
      secondLast.role === 'model' &&
      last.parts.map((p: Part) => p.text ?? '').join('') === secondLast.parts.map((p: Part) => p.text ?? '').join('')
    ) {
      if (last.parts[0]?.text?.startsWith('Error:')) {
        logger.warn('[ChatProcessor] Removing duplicate error message from end of history.');
        currentTurnHistory.pop();
      }
    }
  }

  // Count tokens in the final history before returning
  const finalHistoryTokenCount = await countTokensForHistory(currentTurnHistory);

  logStep(`Returning final response. History length: ${currentTurnHistory.length}, Final Token Count: ${finalHistoryTokenCount}`);
  return [finalResponseText, currentTurnHistory];
}
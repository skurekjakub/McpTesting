// Create file: c:/projects/python/mcpbro/mcpbro-nextjs/src/server/chat-processor.ts
import {
  Content,
  Part,
  GenerateContentResponse,
  FunctionResponsePart,
  Tool,
  HarmCategory,
  HarmBlockThreshold,
  FinishReason,
} from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

import { config, isConfigValid, resolvedProjectRoot } from './config';
import { getGeminiClient } from './initializers';
import { discoverAndFormatTools, handleFunctionCall } from './tool-handler';
// TODO: Create a logging utility similar to Python's utils.py
// import { addDebugLog } from './utils';

// --- Constants ---
const MAX_FUNCTION_CALLS_PER_TURN = 25; // Same as Python version
const SYSTEM_INSTRUCTION_FILENAME = 'system_instruction.md';
const BOT_CONFIG_DIR = 'bot_config'; // Relative to project root

// --- Load System Instruction ---
let systemInstruction = 'Default system instruction if file loading fails.'; // Fallback
const systemInstructionPath = path.join(resolvedProjectRoot, BOT_CONFIG_DIR, SYSTEM_INSTRUCTION_FILENAME);
try {
  if (fs.existsSync(systemInstructionPath)) {
    systemInstruction = fs.readFileSync(systemInstructionPath, 'utf-8').trim();
    console.log(`Successfully loaded system instruction from ${systemInstructionPath}`);
    // addDebugLog(`Successfully loaded system instruction from ${systemInstructionPath}`);
  } else {
    console.warn(`Warning: System instruction file not found at ${systemInstructionPath}. Using default.`);
    // addDebugLog(`Warning: System instruction file not found at ${systemInstructionPath}. Using default.`);
  }
} catch (error: unknown) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  console.error(`Error loading system instruction from ${systemInstructionPath}: ${errorMsg}. Using default.`);
  // addDebugLog(`Error loading system instruction from ${systemInstructionPath}: ${errorMsg}. Using default.`);
}

// --- Type Definitions ---
// Callback for internal steps (optional)
type InternalStepCallback = (message: string) => void;

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
  const log = (message: string) => {
    console.log(`[ChatProcessor] ${message}`);
    // addDebugLog(`[ChatProcessor] ${message}`);
    internalStepCallback?.(message);
  };
  const logError = (message: string, error?: unknown) => {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[ChatProcessor] ERROR: ${message}`, errorMsg);
    // addDebugLog(`[ChatProcessor] ERROR: ${message} ${errorMsg}`);
  };

  let finalResponseText = 'Error: Processing failed to produce a response.';
  const currentTurnHistory: Content[] = [...history]; // Create a mutable copy

  // --- Pre-checks ---
  const geminiClient = getGeminiClient();
  if (!geminiClient) {
    logError('processPrompt called but Gemini client is not initialized.');
    return ['Error: Chat processor not ready.', history]; // Return original history
  }
  if (!isConfigValid) {
    logError('processPrompt called but configuration is invalid.');
    return ['Error: Server configuration invalid.', history];
  }

  let availableTools: Tool[] = []; // Declare availableTools here

  // --- Prepare Initial History & Discover Tools ---
  try {
    log(`Processing prompt: '${userPrompt}'`);
    const userPart: Part = { text: userPrompt };
    currentTurnHistory.push({ role: 'user', parts: [userPart] });

    // TODO: Implement history management (summarization/truncation) if needed
    // const managedHistory = await manageHistoryTokens(currentTurnHistory, geminiClient);
    // currentTurnHistory = managedHistory; // Update history if managed

    log('Discovering tools...');
    availableTools = await discoverAndFormatTools(); // Assign to declared variable
    log(`Discovered ${availableTools.length} tools for this turn.`);
  } catch (error: unknown) {
    logError('Error during initial setup or tool discovery.', error);
    return ['Error preparing request.', history]; // Return original history
  }

  // --- Main Processing Loop ---
  let functionCallCount = 0;
  let safetyBypass = false; // Flag to potentially bypass safety check after function call

  while (functionCallCount < MAX_FUNCTION_CALLS_PER_TURN) {
    log(`--- Starting API Call Loop Iteration ${functionCallCount + 1} ---`);

    try {
      // Prepare the request for the Gemini API
      const generationConfig = {
        temperature: 0.7, // Adjust as needed
        // topK, topP, maxOutputTokens can be added here
      };
      const safetySettings: Array<{ category: HarmCategory; threshold: HarmBlockThreshold }> = [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      ];

      const model = geminiClient.getGenerativeModel({
        model: config.GENERATION_GEMINI_MODEL,
        systemInstruction: { role: 'system', parts: [{ text: systemInstruction }] },
        tools: availableTools.length > 0 ? availableTools : undefined,
        safetySettings: safetyBypass ? undefined : safetySettings, // Conditionally apply safety settings
        generationConfig,
      });

      log(`Sending request to Gemini (iteration ${functionCallCount + 1})...`);
      const result: GenerateContentResponse = await model.generateContent({ contents: currentTurnHistory });
      const response = result.response;

      // --- Validate Response ---
      if (!response) {
        logError('Gemini response was undefined or null.');
        finalResponseText = 'Error: Gemini returned an empty response.';
        break;
      }

      const candidate = response.candidates?.[0];
      if (!candidate) {
        const feedback = response.promptFeedback;
        logError(`Gemini response had no candidates. Feedback: ${JSON.stringify(feedback)}`);
        finalResponseText = `Error: Gemini returned no candidates. ${feedback?.blockReason ? `Reason: ${feedback.blockReason}` : ''}`;
        break;
      }

      // Add the candidate's content (text + function calls) to history
      if (candidate.content) {
        currentTurnHistory.push(candidate.content);
      } else {
        logError('Gemini candidate had no content part.');
      }

      // --- Check for Function Call ---
      const callPart = candidate.content?.parts?.find((part: Part) => !!part.functionCall);
      const call = callPart?.functionCall;

      if (call) {
        functionCallCount++;
        log(`Gemini requested function call #${functionCallCount}: ${call.name}`);
        safetyBypass = true; // Allow potentially unsafe content from tool results

        const toolResponsePayload = await handleFunctionCall(call);

        const functionResponsePart: FunctionResponsePart = {
          functionResponse: toolResponsePayload, // Assign the result directly
        };

        currentTurnHistory.push({ role: 'function', parts: [functionResponsePart] });
        log(`Added function response for ${call.name} to history.`);
      } else {
        // --- No Function Call: Final Response ---
        log('No function call requested. Processing final response.');
        safetyBypass = false; // Reset safety bypass

        const finishReason = candidate.finishReason;
        if (finishReason && [FinishReason.STOP, FinishReason.MAX_TOKENS].includes(finishReason)) {
          finalResponseText = response.text ? response.text() : '';
          if (!finalResponseText && candidate.content?.parts) {
            finalResponseText = candidate.content.parts.map((p: Part) => p.text ?? '').join('');
          }
          log(`Gemini finish reason: ${finishReason}. Final text generated.`);
          if (finishReason === FinishReason.MAX_TOKENS) {
            finalResponseText += '\n\n(Warning: Response may be truncated due to maximum token limit.)';
          }
        } else {
          logError(`Unexpected finish reason: ${finishReason}. Content: ${JSON.stringify(candidate.content)}`);
          finalResponseText = `Error: Unexpected response state from model (Finish Reason: ${finishReason}).`;
        }
        break; // Exit the loop as we have the final response
      }
    } catch (error: unknown) {
      logError('Error during Gemini API call or processing.', error);
      finalResponseText = `An unexpected server error occurred: ${error instanceof Error ? error.message : String(error)}`;
      break; // Exit loop on error
    }
  } // End while loop

  // --- Handle Max Function Calls ---
  if (functionCallCount >= MAX_FUNCTION_CALLS_PER_TURN) {
    logError(`Reached maximum function call limit (${MAX_FUNCTION_CALLS_PER_TURN}).`);
    finalResponseText = `Error: Reached maximum tool call limit (${MAX_FUNCTION_CALLS_PER_TURN}). The request could not be fully completed.`;
  }

  // --- Return Results ---
  const lastMessage = currentTurnHistory[currentTurnHistory.length - 1];
  const lastMessageText = lastMessage?.parts?.map((p: Part) => p.text ?? '').join('');
  if (lastMessage?.role !== 'model' || lastMessageText !== finalResponseText) {
    if (!(lastMessage?.role === 'function' && functionCallCount < MAX_FUNCTION_CALLS_PER_TURN)) {
      if (!finalResponseText.startsWith('Error:') || lastMessageText !== finalResponseText) {
        currentTurnHistory.push({ role: 'model', parts: [{ text: finalResponseText }] });
        log('Added final text/error response to history.');
      }
    }
  }

  log(`Returning final response. History length: ${currentTurnHistory.length}`);
  return [finalResponseText, currentTurnHistory];
}

// TODO: Port history management logic (manageHistoryTokens) if needed
// async function manageHistoryTokens(history: Content[], client: GoogleGenerativeAI): Promise<Content[]> {
//    // Placeholder - implement token counting and summarization/truncation
//    console.log("History management (token counting/summarization) not yet implemented.");
//    return history;
// }
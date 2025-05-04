// Create file: c:/projects/python/mcpbro/mcpbro-nextjs/src/server/chat-processor.ts
import { Content } from '@google/generative-ai';
import { AgentExecutor } from './agent/agent-executor';

// Type definition for the internal callback function (preserved for compatibility)
type InternalStepCallback = (message: string) => void;

// Create a singleton instance of the AgentExecutor
const agentExecutor = new AgentExecutor();

/**
 * Processes user prompt, orchestrates Gemini calls and tool execution.
 * This is now a lightweight facade over our modular agent architecture.
 * 
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
  // Simply delegate to our new AgentExecutor
  return agentExecutor.execute(userPrompt, history, internalStepCallback);
}
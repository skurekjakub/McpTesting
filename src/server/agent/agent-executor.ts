// src/server/agent/agent-executor.ts
import { 
  Content, 
  FinishReason,
  HarmCategory,
  HarmBlockThreshold,
  Tool,
  FunctionCall
} from '@google/generative-ai';
import logger from '../logger';
import { generateContentWithTools } from '../llm/gemini/generation'; 
import { extractTextFromResult, extractFunctionCallFromResult } from '../llm/gemini/parsing';
import { countTokensForText } from '../llm/gemini/tokenization';
import { PromptManager } from './prompt-manager';
import { HistoryManager } from './history-manager';
import { HistoryManagerProvider } from './history/history-manager-provider';
import { ToolOrchestrator } from './tool-orchestrator';
import { agentConfig } from './agent-config';

/**
 * Callback type for internal execution steps
 */
type StepCallback = (message: string) => void;

/**
 * Coordinates the agent execution flow, orchestrating between prompt management,
 * history management, and tool execution.
 */
export class AgentExecutor {
  private promptManager: PromptManager;
  private toolOrchestrator: ToolOrchestrator;
  
  constructor() {
    this.promptManager = new PromptManager();
    this.toolOrchestrator = new ToolOrchestrator();
  }
  
  /**
   * Main execution method that processes a user prompt and returns a response
   * along with updated conversation history.
   * 
   * @param userPrompt The prompt from the user to process
   * @param history The existing conversation history
   * @param stepCallback Optional callback for detailed execution steps
   * @returns A tuple containing [finalResponse, updatedHistory]
   */
  async execute(
    userPrompt: string,
    history: Content[],
    stepCallback?: StepCallback
  ): Promise<[string, Content[]]> {
    const logStep = (message: string) => {
      logger.info(`${agentConfig.logging.agentExecutor} ${message}`);
      if (stepCallback) stepCallback(message);
    };
    
    let finalResponse = agentConfig.defaults.executionFailedMessage;
    let currentHistory: Content[];
    
    try {
      // Get the appropriate history manager based on conversation characteristics
      const historyManager = this.selectHistoryManager(history, userPrompt);
      logStep(`Selected history manager with strategy: ${historyManager.getStrategyName()}`);
      
      // Process history and add user message
      logStep(`Processing prompt: '${userPrompt.substring(0, 100)}${userPrompt.length > 100 ? '...' : ''}'`);
      currentHistory = await historyManager.processHistory(history, userPrompt, logStep);
      
      // Discover available tools
      const tools = await this.toolOrchestrator.discoverTools(logStep);
      
      // Execute the agent loop
      const result = await this.executeAgentLoop(currentHistory, tools, logStep, historyManager);
      finalResponse = result.response;
      currentHistory = result.history;
      
      // Perform final cleanup
      currentHistory = historyManager.cleanupDuplicateResponses(currentHistory);
      currentHistory = historyManager.cleanupEmptyMessages(currentHistory);
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`${agentConfig.logging.agentExecutor} Execution error: ${errorMessage}`, error);
      finalResponse = `An unexpected error occurred: ${errorMessage}`;
      
      // Add error response to history if we have history
      if (history) {
        currentHistory = [...history, this.promptManager.createErrorMessage(finalResponse)];
      } else {
        currentHistory = [this.promptManager.createUserMessage(userPrompt), 
                         this.promptManager.createErrorMessage(finalResponse)];
      }
    }
    
    return [finalResponse, currentHistory];
  }

  /**
   * Selects an appropriate history manager based on conversation characteristics
   * and execution context.
   */
  private selectHistoryManager(history: Content[], userPrompt?: string): HistoryManager {
    // Include the current user prompt in analysis if available
    const historyToAnalyze = userPrompt 
      ? [...history, { role: 'user', parts: [{ text: userPrompt }] }]
      : history;
    
    // Calculate model token limit based on config
    const tokenLimit = agentConfig.summarization.threshold;
      
    // Use the HistoryManagerProvider to get an optimally configured history manager
    return HistoryManagerProvider.provideOptimalHistoryManager(
      historyToAnalyze, 
      { 
        tokenLimit,
        costOptimization: agentConfig.summarization.costOptimizationEnabled
      }
    );
  }
  
  /**
   * Core agent loop that handles the ReAct pattern execution
   * (Reasoning, Acting and Observing)
   */
  private async executeAgentLoop(
    history: Content[],
    tools: Tool[],
    logCallback?: StepCallback,
    historyManager?: HistoryManager
  ): Promise<{ response: string; history: Content[] }> {
    // Use provided history manager or create a default one
    const manager = historyManager || new HistoryManager();
    
    const logStep = (message: string) => {
      logger.info(`${agentConfig.logging.agentExecutor} ${message}`);
      if (logCallback) logCallback(message);
    };
    
    let functionCallCount = 0;
    let currentHistory = [...history];
    let finalResponseText = '';
    let safetyBypass = false;
    
    while (functionCallCount < agentConfig.execution.maxFunctionCallsPerTurn) {
      const iteration = functionCallCount + 1;
      logStep(`--- Starting Agent Loop Iteration ${iteration} ---`);
      
      try {
        // Configure generation parameters
        const generationConfig = { temperature: agentConfig.execution.defaultGenerationTemperature };
        const safetySettings: Array<{ category: HarmCategory; threshold: HarmBlockThreshold }> = [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        ];
        
        // Generate content with LLM
        const result = await generateContentWithTools({
          history: currentHistory,
          tools: tools,
          safetySettings: safetyBypass ? undefined : safetySettings,
          generationConfig,
          systemInstructionText: this.promptManager.getSystemInstruction(),
        });
        
        // Process the response
        const response = result.response;
        const candidate = response.candidates?.[0];
        
        // Handle missing candidate
        if (!candidate) {
          const feedback = response.promptFeedback;
          logger.error(`${agentConfig.logging.agentExecutor} LLM response had no candidates.`, { feedback });
          finalResponseText = `Error: No response generated. ${feedback?.blockReason ? `Reason: ${feedback.blockReason}` : ''}`;
          currentHistory.push(this.promptManager.createErrorMessage(finalResponseText));
          break;
        }
        
        // Add model response to history
        if (candidate.content) {
          currentHistory.push(candidate.content);
        }
        
        // Extract function call if present
        const functionCall = extractFunctionCallFromResult(result);
        
        if (functionCall) {
          // Handle function call (ReAct: Acting)
          functionCallCount++;
          logStep(`LLM requested function call #${functionCallCount}: ${functionCall.name}`);
          safetyBypass = true; // Bypass safety filters for tool responses
          
          // Execute the function and add response to history
          const functionResponse = await this.toolOrchestrator.executeFunctionCall(functionCall, logCallback);
          currentHistory.push(functionResponse);
          
          // Check if we need to summarize after tool calls to manage context length
          if (functionCallCount % 3 === 0) {
            currentHistory = await manager.processHistory(currentHistory, undefined, logCallback);
          }
          
        } else {
          // No function call - final response (ReAct: final reasoning)
          logStep('No function call requested. Processing final response.');
          safetyBypass = false;
          
          // Process final response based on finish reason
          const finishReason = candidate.finishReason;
          if (finishReason && [FinishReason.STOP, FinishReason.MAX_TOKENS].includes(finishReason)) {
            finalResponseText = extractTextFromResult(result);
            
            const tokenCount = await countTokensForText(finalResponseText);
            logStep(`LLM finish reason: ${finishReason}. Final text generated (${tokenCount} tokens).`);
            
            if (finishReason === FinishReason.MAX_TOKENS) {
              logger.warn(`${agentConfig.logging.agentExecutor} Response may be truncated due to MAX_TOKENS finish reason.`);
              finalResponseText += `\n\n${agentConfig.defaults.maxTokensWarning}`;
            }
          } else {
            const unexpectedReason = finishReason || 'UNKNOWN';
            logger.error(`${agentConfig.logging.agentExecutor} Unexpected finish reason: ${unexpectedReason}.`);
            finalResponseText = `Error: Unexpected response state from model (Finish Reason: ${unexpectedReason}).`;
          }
          
          // Ensure the final response is in the history
          const lastHistoryItem = currentHistory[currentHistory.length - 1];
          const lastHistoryText = lastHistoryItem?.role === 'model' ? 
            lastHistoryItem.parts.filter(p => 'text' in p).map(p => (p as any).text || '').join('') : '';
          
          if (lastHistoryItem?.role !== 'model' || lastHistoryText !== finalResponseText) {
            currentHistory.push(this.promptManager.createModelMessage(finalResponseText));
          }
          
          break; // Exit the agent loop as we have a final response
        }
        
      } catch (error: unknown) {
        // Handle errors in the agent loop
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`${agentConfig.logging.agentExecutor} Error during agent loop iteration ${iteration}: ${errorMsg}`, error);
        finalResponseText = `An unexpected error occurred during processing: ${errorMsg}`;
        currentHistory.push(this.promptManager.createErrorMessage(finalResponseText));
        break;
      }
    }
    
    // Handle max function call limit reached
    if (functionCallCount >= agentConfig.execution.maxFunctionCallsPerTurn) {
      logger.error(`${agentConfig.logging.agentExecutor} Reached maximum function call limit (${agentConfig.execution.maxFunctionCallsPerTurn}).`);
      finalResponseText = `Error: Reached maximum tool call limit (${agentConfig.execution.maxFunctionCallsPerTurn}). The request could not be fully completed.`;
      currentHistory.push(this.promptManager.createErrorMessage(finalResponseText));
    }
    
    return { response: finalResponseText, history: currentHistory };
  }
}
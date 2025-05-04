// src/server/agent/tool-orchestrator.ts
import { 
  Tool,
  FunctionCall, 
  FunctionResponsePart,
  FunctionDeclarationsTool,
  Content
} from '@google/generative-ai';
import logger from '../logger';
import { discoverAndFormatTools, handleFunctionCall } from '../tools/mcp/mcp-tool-handler';
import { agentConfig } from './agent-config';

/**
 * Responsible for managing tool discovery, execution, and response handling.
 * Follows Single Responsibility Principle by focusing only on tool orchestration.
 */
export class ToolOrchestrator {
  
  /**
   * Discovers available tools for the agent to use
   */
  async discoverTools(logCallback?: (message: string) => void): Promise<Tool[]> {
    const logStep = (message: string) => {
      logger.info(`${agentConfig.logging.toolOrchestrator} ${message}`);
      if (logCallback) logCallback(message);
    };
    
    logStep('Discovering available tools...');
    const tools = await discoverAndFormatTools();
    
    const functionTool = tools.find(this.isFunctionDeclarationsTool);
    const declarationCount = functionTool?.functionDeclarations?.length ?? 0;
    logStep(`Discovered ${declarationCount} function declarations`);
    
    return tools;
  }
  
  /**
   * Executes a function call and formats the response for adding to history
   */
  async executeFunctionCall(
    call: FunctionCall,
    logCallback?: (message: string) => void
  ): Promise<Content> {
    const toolName = call.name;
    
    const logStep = (message: string) => {
      logger.info(`${agentConfig.logging.toolOrchestrator} ${message}`);
      if (logCallback) logCallback(message);
    };
    
    logStep(`Executing function call: ${toolName}`);
    
    try {
      const responsePayload = await handleFunctionCall(call);
      
      const functionResponsePart: FunctionResponsePart = { 
        functionResponse: responsePayload 
      };
      
      logStep(`Function ${toolName} executed successfully`);
      
      return { 
        role: 'function', 
        parts: [functionResponsePart] 
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logStep(`Error executing function ${toolName}: ${errorMessage}`);
      
      // Return error as function response to maintain continuity
      return {
        role: 'function',
        parts: [{ 
          functionResponse: { 
            name: toolName, 
            response: { error: `Function execution failed: ${errorMessage}` } 
          } 
        }]
      };
    }
  }
  
  /**
   * Type guard for FunctionDeclarationsTool
   */
  private isFunctionDeclarationsTool(tool: Tool): tool is FunctionDeclarationsTool {
    return (tool as FunctionDeclarationsTool).functionDeclarations !== undefined;
  }
}
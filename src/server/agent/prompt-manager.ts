// src/server/agent/prompt-manager.ts
import fs from 'fs';
import path from 'path';
import { Content } from '@google/generative-ai';
import logger from '../logger';
import { resolvedProjectRoot } from '../config/base';
import { agentConfig } from './agent-config';

/**
 * Manages system instructions and prompt preparation for the agent.
 * Follows the Single Responsibility Principle by focusing only on prompt management.
 */
export class PromptManager {
  private systemInstruction: string;
  
  constructor() {
    this.systemInstruction = this.loadSystemInstruction();
  }
  
  /**
   * Loads system instruction text from the configured file
   */
  private loadSystemInstruction(): string {
    const defaultInstruction = agentConfig.defaults.defaultSystemInstruction;
    const systemInstructionPath = path.join(
      resolvedProjectRoot, 
      agentConfig.paths.systemInstructionDirectory, 
      agentConfig.paths.systemInstructionFilename
    );
    
    try {
      if (fs.existsSync(systemInstructionPath)) {
        const instruction = fs.readFileSync(systemInstructionPath, 'utf-8').trim();
        logger.info(`${agentConfig.logging.promptManager} Successfully loaded system instruction from ${systemInstructionPath}`);
        return instruction;
      } else {
        logger.warn(`${agentConfig.logging.promptManager} System instruction file not found at ${systemInstructionPath}. Using default.`);
        return defaultInstruction;
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`${agentConfig.logging.promptManager} Error loading system instruction from ${systemInstructionPath}: ${errorMsg}. Using default.`);
      return defaultInstruction;
    }
  }
  
  /**
   * Get the system instruction text
   */
  getSystemInstruction(): string {
    return this.systemInstruction;
  }
  
  /**
   * Creates a user message from the given text
   */
  createUserMessage(text: string): Content {
    return {
      role: 'user',
      parts: [{ text }]
    };
  }
  
  /**
   * Creates a model message from the given text
   */
  createModelMessage(text: string): Content {
    return {
      role: 'model',
      parts: [{ text }]
    };
  }
  
  /**
   * Creates an error message suitable for adding to history
   */
  createErrorMessage(text: string): Content {
    return {
      role: 'model',
      parts: [{ text: `Error: ${text}` }]
    };
  }
}
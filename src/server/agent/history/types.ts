// src/server/agent/history/types.ts
import { Content } from '@google/generative-ai';

/**
 * Message with additional metadata for scoring importance
 */
export interface ScoredMessage extends Content {
  importanceScore?: number;
}

/**
 * Type for summarization mode options
 */
export type SummarizationMode = 'standard' | 'aggressive';

/**
 * Type for logging callback function used in history processing
 */
export type LogCallback = (message: string) => void;
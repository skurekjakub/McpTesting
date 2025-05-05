import { Content } from "@google/generative-ai";

// Simple vector type
export type EmbeddingVector = number[];

// Interface for an embedding client
export interface IEmbeddingClient {
  embedMessages(messages: Content[]): Promise<EmbeddingVector[]>;
  embedText(text: string): Promise<EmbeddingVector>;
}
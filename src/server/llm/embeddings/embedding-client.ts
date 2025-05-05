import { Content } from '@google/generative-ai';
import { MessageUtils } from '../../agent/history/message-utils';
import logger from '../../logger';
import { EmbeddingVector, IEmbeddingClient } from './types';
import { llmConfig } from '../../config/index';
// Import cosine similarity from ml-distance correctly
import * as mlDistance from 'ml-distance';

// Import Hugging Face components
import { pipeline, Pipeline, Tensor, FeatureExtractionPipeline } from '@huggingface/transformers';

// --- Hugging Face Embedding Client Implementation ---

class HuggingFaceEmbeddingClient implements IEmbeddingClient {
  // Use the specific pipeline type
  private extractor: FeatureExtractionPipeline | null = null;
  private modelName = 'Xenova/all-MiniLM-L6-v2'; // Or make this configurable
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    // Defer initialization until the first use to avoid top-level await issues
    // and allow the server to start faster.
    this.initializationPromise = this.initializeExtractor();
  }

  private async initializeExtractor(): Promise<void> {
    try {
      // Cast device to the expected type for Transformers.js
      const device = llmConfig.EMBEDDING_DEVICE as "cpu" | "auto" | "gpu" | "wasm" | "webgpu" | "cuda" | "dml" | "webnn" | "webnn-gpu" | "webnn-npu" | "webnn-cpu";
      logger.info(`[Embeddings] Initializing Hugging Face feature-extraction pipeline with model: ${this.modelName} on device: ${device}...`);
      
      // Create pipeline with device specification
      // Use double type assertion to work around TypeScript complexity limit
      const pipelineResult = await pipeline('feature-extraction', this.modelName, { device });
      this.extractor = pipelineResult as unknown as FeatureExtractionPipeline;
      
      this.isInitialized = true;
      logger.info(`[Embeddings] Hugging Face pipeline initialized successfully on device: ${device}.`);
    } catch (error: any) {
      logger.error(`[Embeddings] Failed to initialize Hugging Face pipeline: ${error.message}`, { stack: error.stack });
      this.isInitialized = false;
      throw new Error(`Failed to initialize Hugging Face pipeline: ${error.message}`);
    } finally {
      this.initializationPromise = null;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initializationPromise) {
        await this.initializationPromise; // Wait if initialization is in progress
    }
    if (!this.isInitialized || !this.extractor) {
      // If initialization failed previously or wasn't triggered, attempt it again or throw
      logger.error('[Embeddings] Hugging Face pipeline is not initialized.');
      throw new Error('Hugging Face pipeline is not initialized.');
      // Alternatively, you could retry initialization here:
      // await this.initializeExtractor();
      // if (!this.isInitialized || !this.extractor) {
      //   throw new Error('Hugging Face pipeline failed to initialize on demand.');
      // }
    }
  }

  private async generateEmbeddings(texts: string[]): Promise<EmbeddingVector[]> {
    await this.ensureInitialized();
    if (!this.extractor) {
        // This should theoretically not be reached if ensureInitialized works correctly
        throw new Error("Extractor pipeline is not available after initialization check.");
    }

    if (texts.length === 0) {
        return [];
    }
    logger.debug(`[Embeddings] Requesting Hugging Face embeddings for ${texts.length} texts...`);

    try {
      // Compute embeddings
      const output: Tensor = await this.extractor(texts, { pooling: 'mean', normalize: true });
      const embeddings = output.tolist() as EmbeddingVector[]; // Convert Tensor to nested array

      if (embeddings.length !== texts.length) {
          logger.warn(`[Embeddings] Mismatch between requested texts (${texts.length}) and received HF embeddings (${embeddings.length}).`);
          // Handle mismatch? For now, log and continue.
      }

      logger.debug(`[Embeddings] Successfully received ${embeddings.length} embeddings from Hugging Face pipeline.`);
      return embeddings;

    } catch (error: any) {
      logger.error(`[Embeddings] Error calling Hugging Face pipeline: ${error.message}`, { stack: error.stack });
      throw new Error(`Hugging Face embedding generation failed: ${error.message}`);
    }
  }

  async embedMessages(messages: Content[]): Promise<EmbeddingVector[]> {
    const texts = messages.map(msg => MessageUtils.getTextContent(msg));
    // Filter out empty texts as they might cause issues
    const validTexts = texts.filter(text => text.trim().length > 0);
    if (validTexts.length !== texts.length) {
        logger.warn(`[Embeddings] Filtered out ${texts.length - validTexts.length} empty messages before embedding.`);
    }
    if (validTexts.length === 0) {
        return [];
    }
    return this.generateEmbeddings(validTexts);
  }

  async embedText(text: string): Promise<EmbeddingVector> {
    if (text.trim().length === 0) {
        logger.warn('[Embeddings] Attempted to embed empty text. Returning zero vector.');
        // Determine dimensionality from the model if possible, or hardcode.
        // all-MiniLM-L6-v2 has 384 dimensions.
        const dimensionality = 384;
        return new Array(dimensionality).fill(0);
    }
    const embeddings = await this.generateEmbeddings([text]);
    if (embeddings.length === 0) {
        throw new Error('Failed to get embedding for text from Hugging Face.');
    }
    return embeddings[0];
  }
}

// Export a singleton instance of the new client
export const embeddingClient: IEmbeddingClient = new HuggingFaceEmbeddingClient();

/**
 * Calculate cosine similarity between two vectors
 * Uses ml-distance library which is optimized for performance and handles edge cases
 * 
 * @param vecA First embedding vector
 * @param vecB Second embedding vector
 * @returns Similarity score between -1 and 1 (1 being identical, 0 being orthogonal)
 */
export function cosineSimilarity(vecA: EmbeddingVector, vecB: EmbeddingVector): number {
    if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) {
        logger.warn('[Embeddings] Invalid input for cosineSimilarity.');
        return 0;
    }
    
    try {
        // ml-distance similarity.cosine directly returns the similarity (not distance)
        const similarity = mlDistance.similarity.cosine(vecA, vecB);
        // Ensure the result is within the valid range [-1, 1] to handle any floating-point issues
        return Math.max(-1, Math.min(1, similarity));
    } catch (error) {
        logger.error(`[Embeddings] Error calculating cosine similarity: ${error}`);
        // Fallback to 0 (orthogonal/unrelated) on error
        return 0;
    }
}

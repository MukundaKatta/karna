// ─── Embedding Generation ──────────────────────────────────────────────────

import OpenAI from "openai";
import pino from "pino";

const logger = pino({ name: "embedder" });

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIMENSIONS = 1536;
const MAX_BATCH_SIZE = 100;
const MAX_INPUT_LENGTH = 8191; // OpenAI token limit for embedding models

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EmbeddingResult {
  embedding: number[];
  tokenCount: number;
}

export interface BatchEmbeddingResult {
  embeddings: number[][];
  totalTokens: number;
}

export interface EmbedderConfig {
  apiKey?: string;
  model?: string;
  dimensions?: number;
}

// ─── Embedder ───────────────────────────────────────────────────────────────

/**
 * Generate vector embeddings for text using the OpenAI embeddings API.
 * Supports single and batch embedding with automatic chunking.
 */
export class Embedder {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly dimensions: number;

  constructor(config?: EmbedderConfig) {
    this.client = new OpenAI({
      apiKey: config?.apiKey ?? process.env.OPENAI_API_KEY,
    });
    this.model = config?.model ?? DEFAULT_MODEL;
    this.dimensions = config?.dimensions ?? DEFAULT_DIMENSIONS;
  }

  /**
   * Generate an embedding for a single text input.
   */
  async embed(text: string): Promise<EmbeddingResult> {
    const truncated = this.truncateInput(text);

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: truncated,
        dimensions: this.dimensions,
      });

      const data = response.data[0];
      return {
        embedding: data.embedding,
        tokenCount: response.usage.total_tokens,
      };
    } catch (error: unknown) {
      logger.error({ error, model: this.model }, "Embedding generation failed");
      throw new EmbeddingError(
        `Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Generate embeddings for multiple texts in batches.
   * Automatically splits into chunks of MAX_BATCH_SIZE.
   */
  async embedBatch(texts: string[]): Promise<BatchEmbeddingResult> {
    if (texts.length === 0) {
      return { embeddings: [], totalTokens: 0 };
    }

    const truncated = texts.map((t) => this.truncateInput(t));
    const allEmbeddings: number[][] = [];
    let totalTokens = 0;

    // Process in batches
    for (let i = 0; i < truncated.length; i += MAX_BATCH_SIZE) {
      const batch = truncated.slice(i, i + MAX_BATCH_SIZE);

      try {
        const response = await this.client.embeddings.create({
          model: this.model,
          input: batch,
          dimensions: this.dimensions,
        });

        // Sort by index to maintain order
        const sorted = response.data.sort((a, b) => a.index - b.index);
        for (const item of sorted) {
          allEmbeddings.push(item.embedding);
        }
        totalTokens += response.usage.total_tokens;
      } catch (error: unknown) {
        logger.error(
          { error, batchStart: i, batchSize: batch.length },
          "Batch embedding failed"
        );
        throw new EmbeddingError(
          `Batch embedding failed at offset ${i}: ${error instanceof Error ? error.message : String(error)}`,
          error
        );
      }
    }

    logger.debug(
      { textCount: texts.length, totalTokens },
      "Batch embedding completed"
    );

    return { embeddings: allEmbeddings, totalTokens };
  }

  /**
   * Get the configured embedding dimensions.
   */
  getDimensions(): number {
    return this.dimensions;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private truncateInput(text: string): string {
    // Rough character-based truncation (tokens ~ chars/4)
    const maxChars = MAX_INPUT_LENGTH * 4;
    if (text.length > maxChars) {
      logger.warn(
        { originalLength: text.length, maxChars },
        "Truncating embedding input"
      );
      return text.slice(0, maxChars);
    }
    return text;
  }
}

// ─── Convenience Function ───────────────────────────────────────────────────

let defaultEmbedder: Embedder | null = null;

/**
 * Generate an embedding using the default embedder instance.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!defaultEmbedder) {
    defaultEmbedder = new Embedder();
  }
  const result = await defaultEmbedder.embed(text);
  return result.embedding;
}

// ─── Errors ───────────────────────────────────────────────────────────────

export class EmbeddingError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

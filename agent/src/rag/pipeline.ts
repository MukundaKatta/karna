// ─── RAG Pipeline ───────────────────────────────────────────────────────────
// Orchestrates document ingestion (chunk → embed → store) and
// query retrieval (retrieve → format context).

import pino from "pino";
import { chunkText, type ChunkOptions, type TextChunk } from "./chunker.js";
import { RAGRetriever, type RetrieveOptions, type RetrievalResult } from "./retriever.js";
import type { MemoryBackend, SaveMemoryInput } from "../memory/store.js";

const logger = pino({ name: "rag-pipeline" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EmbedFunction {
  (text: string): Promise<number[]>;
}

export interface IngestOptions extends ChunkOptions {
  /** Document title for metadata. */
  title?: string;
  /** Document source URL or path. */
  source?: string;
  /** Document type (e.g., "markdown", "text", "pdf"). */
  documentType?: string;
  /** Agent ID that owns this document. */
  agentId: string;
}

export interface IngestResult {
  documentId: string;
  chunksCreated: number;
  totalTokens: number;
}

export interface QueryOptions extends RetrieveOptions {
  /** Agent ID to search within. */
  agentId: string;
}

// ─── RAG Pipeline ──────────────────────────────────────────────────────────

export class RAGPipeline {
  private readonly backend: MemoryBackend;
  private readonly embedFn: EmbedFunction | null;
  private readonly retriever: RAGRetriever;
  private documentCounter = 0;

  constructor(backend: MemoryBackend, embedFn?: EmbedFunction) {
    this.backend = backend;
    this.embedFn = embedFn ?? null;
    this.retriever = new RAGRetriever(backend);
  }

  /**
   * Ingest a document: chunk → embed → store.
   */
  async ingest(text: string, options: IngestOptions): Promise<IngestResult> {
    const documentId = `doc_${++this.documentCounter}_${Date.now()}`;

    logger.info(
      { documentId, title: options.title, textLength: text.length },
      "Ingesting document",
    );

    // Chunk the text
    const chunks = chunkText(text, {
      chunkSize: options.chunkSize,
      overlap: options.overlap,
      metadata: {
        documentId,
        title: options.title,
        source: options.source,
        documentType: options.documentType,
      },
    });

    if (chunks.length === 0) {
      logger.warn({ documentId }, "Document produced no chunks");
      return { documentId, chunksCreated: 0, totalTokens: 0 };
    }

    // Embed and store each chunk
    let totalTokens = 0;
    let stored = 0;

    for (const chunk of chunks) {
      try {
        let embedding: number[] | undefined;
        if (this.embedFn) {
          embedding = await this.embedFn(chunk.content);
        }

        const input: SaveMemoryInput = {
          agentId: options.agentId,
          content: chunk.content,
          summary: chunk.content.slice(0, 200),
          source: "document",
          priority: "normal",
          tags: [options.documentType ?? "text", `doc:${documentId}`],
          category: "rag",
          embedding,
        };

        await this.backend.save(input);
        totalTokens += chunk.tokenCount;
        stored++;
      } catch (error) {
        logger.error(
          { error: String(error), chunkIndex: chunk.index, documentId },
          "Failed to store chunk",
        );
      }
    }

    logger.info(
      { documentId, chunksCreated: stored, totalTokens, totalChunks: chunks.length },
      "Document ingested",
    );

    return { documentId, chunksCreated: stored, totalTokens };
  }

  /**
   * Query: retrieve relevant chunks and format as context.
   */
  async query(
    question: string,
    options: QueryOptions,
  ): Promise<{ context: string; results: RetrievalResult[] }> {
    logger.debug({ question: question.slice(0, 100) }, "RAG query");

    let embedding: number[] = [];
    if (this.embedFn) {
      try {
        embedding = await this.embedFn(question);
      } catch (error) {
        logger.warn({ error: String(error) }, "Failed to embed query — falling back to empty");
      }
    }

    const results = await this.retriever.retrieve(
      question,
      embedding,
      options.agentId,
      options,
    );

    const context = this.formatContext(results);

    logger.debug(
      { resultCount: results.length, contextLength: context.length },
      "RAG query complete",
    );

    return { context, results };
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private formatContext(results: RetrievalResult[]): string {
    if (results.length === 0) return "";

    const sections = results.map((r, i) => {
      return `[Source ${i + 1}] (score: ${r.score.toFixed(3)})\n${r.content}`;
    });

    return `Relevant context:\n\n${sections.join("\n\n---\n\n")}`;
  }
}

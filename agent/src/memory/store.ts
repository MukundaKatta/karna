// ─── Memory Store ──────────────────────────────────────────────────────────

import pino from "pino";
import type { MemoryEntry, MemorySource, MemoryPriority } from "@karna/shared/types/memory.js";

const logger = pino({ name: "memory-store" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SaveMemoryInput {
  agentId: string;
  content: string;
  summary?: string;
  source: MemorySource;
  priority?: MemoryPriority;
  category?: string;
  tags?: string[];
  embedding?: number[];
  sessionId?: string;
  userId?: string;
  relatedMessageIds?: string[];
  expiresAt?: number;
}

export interface MemorySearchParams {
  agentId: string;
  embedding: number[];
  limit?: number;
  minRelevance?: number;
  category?: string;
  tags?: string[];
  source?: MemorySource;
}

export interface ScoredMemory extends MemoryEntry {
  score: number;
}

/**
 * Backend interface for memory persistence.
 * The default implementation targets Supabase with pgvector.
 */
export interface MemoryBackend {
  save(input: SaveMemoryInput): Promise<MemoryEntry>;
  search(params: MemorySearchParams): Promise<ScoredMemory[]>;
  listByAgent(agentId: string): Promise<MemoryEntry[]>;
  getById(id: string): Promise<MemoryEntry | null>;
  delete(id: string): Promise<boolean>;
  updateAccessedAt(id: string): Promise<void>;
}

// ─── Memory Store ───────────────────────────────────────────────────────────

/**
 * High-level memory store that wraps a backend implementation.
 * Handles ID generation, timestamps, and logging.
 */
export class MemoryStore {
  private readonly backend: MemoryBackend;

  constructor(backend: MemoryBackend) {
    this.backend = backend;
  }

  /**
   * Save a new memory entry.
   */
  async save(input: SaveMemoryInput): Promise<MemoryEntry> {
    logger.debug(
      { agentId: input.agentId, source: input.source, category: input.category },
      "Saving memory"
    );

    const entry = await this.backend.save(input);

    logger.info(
      { memoryId: entry.id, agentId: input.agentId, source: input.source },
      "Memory saved"
    );

    return entry;
  }

  /**
   * Search memories by embedding similarity.
   */
  async search(params: MemorySearchParams): Promise<ScoredMemory[]> {
    logger.debug(
      { agentId: params.agentId, limit: params.limit, category: params.category },
      "Searching memories"
    );

    const results = await this.backend.search(params);

    // Update accessed timestamps for returned results
    await Promise.allSettled(
      results.map((r) => this.backend.updateAccessedAt(r.id))
    );

    logger.debug(
      { agentId: params.agentId, resultCount: results.length },
      "Memory search completed"
    );

    return results;
  }

  /**
   * Get a memory entry by ID.
   */
  async getById(id: string): Promise<MemoryEntry | null> {
    return this.backend.getById(id);
  }

  /**
   * List all memories for an agent.
   */
  async listByAgent(agentId: string): Promise<MemoryEntry[]> {
    return this.backend.listByAgent(agentId);
  }

  /**
   * Delete a memory entry.
   */
  async delete(id: string): Promise<boolean> {
    const deleted = await this.backend.delete(id);
    if (deleted) {
      logger.info({ memoryId: id }, "Memory deleted");
    }
    return deleted;
  }
}

// ─── In-Memory Backend (Development/Testing) ──────────────────────────────

/**
 * Simple in-memory backend for development and testing.
 * Not suitable for production use.
 */
export class InMemoryBackend implements MemoryBackend {
  private readonly entries = new Map<string, MemoryEntry>();
  private readonly agentIds = new Map<string, string>();
  private counter = 0;

  async save(input: SaveMemoryInput): Promise<MemoryEntry> {
    const now = Date.now();
    const id = `mem_${++this.counter}_${now}`;

    const entry: MemoryEntry = {
      id,
      sessionId: input.sessionId,
      userId: input.userId,
      content: input.content,
      summary: input.summary,
      embedding: input.embedding,
      source: input.source,
      priority: input.priority ?? "normal",
      tags: input.tags ?? [],
      category: input.category,
      relatedMessageIds: input.relatedMessageIds ?? [],
      relatedMemoryIds: [],
      createdAt: now,
      updatedAt: now,
      accessedAt: now,
      expiresAt: input.expiresAt,
      accessCount: 0,
      decayFactor: 1,
    };

    this.entries.set(id, entry);
    this.agentIds.set(id, input.agentId);
    return entry;
  }

  async search(params: MemorySearchParams): Promise<ScoredMemory[]> {
    const limit = params.limit ?? 10;
    const minRelevance = params.minRelevance ?? 0;

    let candidates = Array.from(this.entries.values());

    // Filter by category/tags/source
    if (params.category) {
      candidates = candidates.filter((e) => e.category === params.category);
    }
    if (params.tags && params.tags.length > 0) {
      const tagSet = new Set(params.tags);
      candidates = candidates.filter((e) =>
        e.tags.some((t) => tagSet.has(t))
      );
    }
    if (params.source) {
      candidates = candidates.filter((e) => e.source === params.source);
    }

    // Compute cosine similarity if embeddings are available
    const scored: ScoredMemory[] = candidates.map((entry) => {
      let score = 0;
      if (entry.embedding && params.embedding.length > 0) {
        score = cosineSimilarity(params.embedding, entry.embedding);
      }
      return { ...entry, score };
    });

    return scored
      .filter((s) => s.score >= minRelevance)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async getById(id: string): Promise<MemoryEntry | null> {
    return this.entries.get(id) ?? null;
  }

  async listByAgent(agentId: string): Promise<MemoryEntry[]> {
    return Array.from(this.entries.entries())
      .filter(([id]) => this.agentIds.get(id) === agentId)
      .map(([, entry]) => entry)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async delete(id: string): Promise<boolean> {
    this.agentIds.delete(id);
    return this.entries.delete(id);
  }

  async updateAccessedAt(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry) {
      entry.accessedAt = Date.now();
      entry.accessCount += 1;
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

// ─── RAG Retriever ──────────────────────────────────────────────────────────
// Hybrid search combining vector similarity with keyword matching.
// Uses Reciprocal Rank Fusion (RRF) to merge results.

import pino from "pino";
import type { ScoredMemory, MemorySearchParams, MemoryBackend } from "../memory/store.js";

const logger = pino({ name: "rag-retriever" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RetrievalResult {
  id: string;
  content: string;
  score: number;
  source: "vector" | "keyword" | "hybrid";
  metadata?: Record<string, unknown>;
}

export interface RetrieveOptions {
  /** Number of results to return. Default: 5. */
  topK?: number;
  /** Number of candidates to fetch before reranking. Default: 20. */
  candidateCount?: number;
  /** Weight for vector search in hybrid scoring. Default: 0.7. */
  vectorWeight?: number;
  /** Weight for keyword search in hybrid scoring. Default: 0.3. */
  keywordWeight?: number;
  /** RRF constant k. Default: 60. */
  rrfK?: number;
  /** Minimum score threshold. Default: 0. */
  minScore?: number;
}

// ─── Retriever ──────────────────────────────────────────────────────────────

export class RAGRetriever {
  private readonly backend: MemoryBackend;

  constructor(backend: MemoryBackend) {
    this.backend = backend;
  }

  /**
   * Retrieve relevant documents using hybrid search.
   */
  async retrieve(
    query: string,
    embedding: number[],
    agentId: string,
    options?: RetrieveOptions,
  ): Promise<RetrievalResult[]> {
    const topK = options?.topK ?? 5;
    const candidateCount = options?.candidateCount ?? 20;
    const vectorWeight = options?.vectorWeight ?? 0.7;
    const keywordWeight = options?.keywordWeight ?? 0.3;
    const rrfK = options?.rrfK ?? 60;
    const minScore = options?.minScore ?? 0;

    logger.debug({ query: query.slice(0, 100), topK, candidateCount }, "Retrieving documents");

    // Vector search
    const vectorResults = await this.backend.search({
      agentId,
      embedding,
      limit: candidateCount,
    });

    // Keyword search (simple text matching as fallback)
    const keywordResults = this.keywordSearch(vectorResults, query);

    // Merge with RRF
    const merged = this.reciprocalRankFusion(
      vectorResults,
      keywordResults,
      vectorWeight,
      keywordWeight,
      rrfK,
    );

    const results = merged
      .filter((r) => r.score >= minScore)
      .slice(0, topK);

    logger.debug(
      { vectorCount: vectorResults.length, resultCount: results.length },
      "Retrieval complete",
    );

    return results;
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  /**
   * Simple keyword matching on vector results for hybrid scoring.
   * In production, this would use PostgreSQL tsvector/tsquery.
   */
  private keywordSearch(
    candidates: ScoredMemory[],
    query: string,
  ): ScoredMemory[] {
    const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

    if (queryTerms.length === 0) return [];

    const scored = candidates.map((candidate) => {
      const content = candidate.content.toLowerCase();
      let matchCount = 0;

      for (const term of queryTerms) {
        if (content.includes(term)) matchCount++;
      }

      const keywordScore = queryTerms.length > 0 ? matchCount / queryTerms.length : 0;

      return { ...candidate, score: keywordScore };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Reciprocal Rank Fusion: merges ranked lists from different sources.
   * score = sum(weight / (k + rank)) for each list where the item appears.
   */
  private reciprocalRankFusion(
    vectorResults: ScoredMemory[],
    keywordResults: ScoredMemory[],
    vectorWeight: number,
    keywordWeight: number,
    k: number,
  ): RetrievalResult[] {
    const scores = new Map<string, { score: number; content: string; source: "vector" | "keyword" | "hybrid" }>();

    // Score from vector results
    for (let i = 0; i < vectorResults.length; i++) {
      const r = vectorResults[i];
      const rrfScore = vectorWeight / (k + i + 1);
      scores.set(r.id, {
        score: rrfScore,
        content: r.content,
        source: "vector",
      });
    }

    // Add scores from keyword results
    for (let i = 0; i < keywordResults.length; i++) {
      const r = keywordResults[i];
      const rrfScore = keywordWeight / (k + i + 1);
      const existing = scores.get(r.id);

      if (existing) {
        existing.score += rrfScore;
        existing.source = "hybrid";
      } else {
        scores.set(r.id, {
          score: rrfScore,
          content: r.content,
          source: "keyword",
        });
      }
    }

    return Array.from(scores.entries())
      .map(([id, data]) => ({
        id,
        content: data.content,
        score: data.score,
        source: data.source,
      }))
      .sort((a, b) => b.score - a.score);
  }
}

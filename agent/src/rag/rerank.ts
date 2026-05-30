// ─── Reranking Stage ──────────────────────────────────────────────────────────
// Issue #599. A pluggable reranker interface plus:
//  - a default heuristic cross-score reranker that blends the upstream
//    retrieval score with cheap lexical signals (query-term coverage + phrase
//    match), and
//  - a model-based reranker that delegates to an injected async scoring
//    function (e.g. a cross-encoder / LLM) — no new dependencies, fully
//    optional. Rerankers reorder the top-k candidates from a retriever.

import type { RetrievalResult } from "./retriever.js";
import { tokenize } from "./hybrid.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RerankResult extends RetrievalResult {
  /** Score assigned by the reranker (higher is better). */
  rerankScore: number;
  /** Candidate's original (pre-rerank) retrieval score. */
  originalScore: number;
}

export interface Reranker {
  /** Reorder candidates for the query, returning at most `topK`. */
  rerank(
    query: string,
    candidates: RetrievalResult[],
    topK?: number,
  ): Promise<RerankResult[]>;
}

export interface HeuristicRerankOptions {
  /**
   * Weight on the original retrieval score. The lexical heuristic gets weight
   * (1 - retrievalWeight). Default 0.5.
   */
  retrievalWeight: number;
  /** Bonus added when the full query phrase appears in the chunk. Default 0.15. */
  phraseBonus: number;
}

export const DEFAULT_HEURISTIC_OPTIONS: HeuristicRerankOptions = {
  retrievalWeight: 0.5,
  phraseBonus: 0.15,
};

// ─── Lexical scoring ──────────────────────────────────────────────────────────

/**
 * Normalised lexical relevance (0..1) of a chunk for a query: fraction of
 * unique query terms present, plus a phrase-match bonus. Pure & deterministic.
 */
export function lexicalScore(
  query: string,
  text: string,
  phraseBonus = DEFAULT_HEURISTIC_OPTIONS.phraseBonus,
): number {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return 0;
  const docTerms = new Set(tokenize(text));
  const unique = new Set(queryTerms);
  let covered = 0;
  for (const term of unique) if (docTerms.has(term)) covered += 1;
  const coverage = covered / unique.size;
  const phraseHit =
    query.trim().length > 0 &&
    text.toLowerCase().includes(query.trim().toLowerCase());
  return Math.min(1, coverage + (phraseHit ? phraseBonus : 0));
}

// ─── Heuristic reranker ───────────────────────────────────────────────────────

/** Default heuristic / cross-score reranker. No external model required. */
export class HeuristicReranker implements Reranker {
  private readonly options: HeuristicRerankOptions;

  constructor(options: Partial<HeuristicRerankOptions> = {}) {
    this.options = { ...DEFAULT_HEURISTIC_OPTIONS, ...options };
  }

  async rerank(
    query: string,
    candidates: RetrievalResult[],
    topK?: number,
  ): Promise<RerankResult[]> {
    const { retrievalWeight, phraseBonus } = this.options;
    const w = Math.max(0, Math.min(1, retrievalWeight));

    const scored: RerankResult[] = candidates.map((c) => {
      const lex = lexicalScore(query, c.content, phraseBonus);
      const rerankScore = w * c.score + (1 - w) * lex;
      return { ...c, originalScore: c.score, rerankScore, score: rerankScore };
    });

    scored.sort((a, b) => b.rerankScore - a.rerankScore);
    return typeof topK === "number" ? scored.slice(0, topK) : scored;
  }
}

// ─── Model-based reranker ─────────────────────────────────────────────────────

/**
 * Async scoring function for a model-based reranker. Implementations may call a
 * cross-encoder, an LLM, or any external service. Returns one score per
 * candidate, aligned by index with the input array.
 */
export type CrossScoreFn = (
  query: string,
  candidates: RetrievalResult[],
) => Promise<number[]>;

/**
 * Model-based reranker. Pure plumbing around an injected `CrossScoreFn`; it
 * ships no model, so it adds no dependencies — a ready integration point.
 */
export class ModelReranker implements Reranker {
  private readonly scoreFn: CrossScoreFn;

  constructor(scoreFn: CrossScoreFn) {
    this.scoreFn = scoreFn;
  }

  async rerank(
    query: string,
    candidates: RetrievalResult[],
    topK?: number,
  ): Promise<RerankResult[]> {
    if (candidates.length === 0) return [];
    const scores = await this.scoreFn(query, candidates);
    const scored: RerankResult[] = candidates.map((c, i) => {
      const s = Number.isFinite(scores[i]) ? scores[i] : c.score;
      return { ...c, originalScore: c.score, rerankScore: s, score: s };
    });
    scored.sort((a, b) => b.rerankScore - a.rerankScore);
    return typeof topK === "number" ? scored.slice(0, topK) : scored;
  }
}

/** Convenience: rerank with the default heuristic reranker. */
export async function rerank(
  query: string,
  candidates: RetrievalResult[],
  topK?: number,
  options: Partial<HeuristicRerankOptions> = {},
): Promise<RerankResult[]> {
  return new HeuristicReranker(options).rerank(query, candidates, topK);
}

export default HeuristicReranker;

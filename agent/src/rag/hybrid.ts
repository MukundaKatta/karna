// ─── Hybrid Search (BM25 + Vector) ────────────────────────────────────────────
// Issue #597. Self-contained, dependency-free BM25 lexical scorer over a small
// in-memory corpus plus Reciprocal Rank Fusion (RRF) to merge a vector
// (semantic) ranking with a lexical ranking. Pure — no network, no models.
//
// This complements the existing RAGRetriever's RRF (which fuses a fetched
// vector candidate set with substring keyword matching) by providing a real
// BM25 ranking that can be computed entirely client-side over arbitrary text.

import type { TextChunk } from "./chunker.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A scored item in a ranked list. Higher score = more relevant. */
export interface ScoredItem {
  /** Stable id used to align lexical and vector rankings. */
  id: string;
  /** Score in the source ranking. */
  score: number;
}

/** A fused result with combined RRF score and the component ranks. */
export interface FusedResult<T extends { id: string } = { id: string }> {
  id: string;
  /** Combined reciprocal-rank-fusion score. */
  score: number;
  /** Zero-based rank in the vector list, or null if absent. */
  vectorRank: number | null;
  /** Zero-based rank in the lexical list, or null if absent. */
  lexicalRank: number | null;
  /** The original item, when it could be resolved. */
  item?: T;
}

export interface Bm25Options {
  /** Term-frequency saturation. Higher => slower saturation. Default 1.5. */
  k1: number;
  /** Length normalisation strength (0 = none, 1 = full). Default 0.75. */
  b: number;
}

export const DEFAULT_BM25_OPTIONS: Bm25Options = {
  k1: 1.5,
  b: 0.75,
};

// ─── Tokenizer ──────────────────────────────────────────────────────────────

/** Default tokenizer: lowercase, split on non-alphanumeric, drop empties. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 0);
}

// ─── BM25 ─────────────────────────────────────────────────────────────────────

interface IndexedDoc {
  id: string;
  length: number;
  termFreq: Map<string, number>;
}

/**
 * A small in-memory BM25 scorer. Build once over a corpus, then query.
 *
 * BM25(Q, D) = sum over t in Q of
 *   IDF(t) * (f(t,D) * (k1+1)) / (f(t,D) + k1 * (1 - b + b * |D|/avgdl))
 * with IDF(t) = ln(1 + (N - n(t) + 0.5) / (n(t) + 0.5)).
 */
export class BM25 {
  private readonly docs: IndexedDoc[] = [];
  private readonly docFreq = new Map<string, number>();
  private avgDocLength = 0;
  private readonly options: Bm25Options;
  private readonly tokenizer: (text: string) => string[];

  constructor(
    options: Partial<Bm25Options> = {},
    tokenizer: (text: string) => string[] = tokenize,
  ) {
    this.options = { ...DEFAULT_BM25_OPTIONS, ...options };
    this.tokenizer = tokenizer;
  }

  /** Number of documents currently indexed. */
  get size(): number {
    return this.docs.length;
  }

  /** Add a single document to the index. */
  add(id: string, text: string): void {
    const tokens = this.tokenizer(text);
    const termFreq = new Map<string, number>();
    for (const tok of tokens) termFreq.set(tok, (termFreq.get(tok) ?? 0) + 1);
    for (const term of termFreq.keys()) {
      this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
    }
    this.docs.push({ id, length: tokens.length, termFreq });
    this.recomputeAvg();
  }

  /** Bulk-add documents. */
  addAll(items: Array<{ id: string; text: string }>): void {
    for (const it of items) this.add(it.id, it.text);
  }

  private recomputeAvg(): void {
    if (this.docs.length === 0) {
      this.avgDocLength = 0;
      return;
    }
    let total = 0;
    for (const d of this.docs) total += d.length;
    this.avgDocLength = total / this.docs.length;
  }

  private idf(term: string): number {
    const n = this.docFreq.get(term) ?? 0;
    const N = this.docs.length;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }

  private scoreIndexed(queryTerms: string[], doc: IndexedDoc): number {
    const { k1, b } = this.options;
    let score = 0;
    for (const term of queryTerms) {
      const f = doc.termFreq.get(term);
      if (!f) continue;
      const idf = this.idf(term);
      const denom = f + k1 * (1 - b + (b * doc.length) / (this.avgDocLength || 1));
      score += idf * ((f * (k1 + 1)) / (denom || 1));
    }
    return score;
  }

  /**
   * Rank all indexed documents against the query, returning the top results.
   * Documents with a non-positive score are omitted.
   */
  search(query: string, topK = 10): ScoredItem[] {
    const queryTerms = this.tokenizer(query);
    const results: ScoredItem[] = [];
    for (const doc of this.docs) {
      const score = this.scoreIndexed(queryTerms, doc);
      if (score > 0) results.push({ id: doc.id, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }
}

/** Convenience: build a BM25 index over text chunks and search it. */
export function bm25Search(
  chunks: TextChunk[],
  query: string,
  topK = 10,
  options: Partial<Bm25Options> = {},
): ScoredItem[] {
  const index = new BM25(options);
  index.addAll(chunks.map((c) => ({ id: c.id, text: c.content })));
  return index.search(query, topK);
}

// ─── Reciprocal Rank Fusion ───────────────────────────────────────────────────

export interface FuseOptions {
  /** RRF damping constant; standard value is 60. */
  k: number;
  /** Weight applied to the vector list contribution. Default 1. */
  vectorWeight: number;
  /** Weight applied to the lexical list contribution. Default 1. */
  lexicalWeight: number;
  /** Max number of fused results to return (0 = unlimited). */
  topK: number;
}

export const DEFAULT_FUSE_OPTIONS: FuseOptions = {
  k: 60,
  vectorWeight: 1,
  lexicalWeight: 1,
  topK: 0,
};

/**
 * Reciprocal Rank Fusion of two ranked lists.
 *
 * RRF(d) = sum over lists L of weight_L / (k + rank_L(d)), rank zero-based.
 * Items present in only one list still score. Lists are taken in given order
 * as the ranking (index = rank), so pass them sorted best-first.
 */
export function fuse<T extends { id: string }>(
  vectorResults: T[],
  lexicalResults: T[],
  options: Partial<FuseOptions> = {},
): FusedResult<T>[] {
  const opts = { ...DEFAULT_FUSE_OPTIONS, ...options };
  const k = opts.k;
  const byId = new Map<string, FusedResult<T>>();

  const ensure = (id: string): FusedResult<T> => {
    let entry = byId.get(id);
    if (!entry) {
      entry = { id, score: 0, vectorRank: null, lexicalRank: null };
      byId.set(id, entry);
    }
    return entry;
  };

  vectorResults.forEach((item, rank) => {
    const entry = ensure(item.id);
    entry.vectorRank = rank;
    entry.item = item;
    entry.score += opts.vectorWeight / (k + rank);
  });

  lexicalResults.forEach((item, rank) => {
    const entry = ensure(item.id);
    entry.lexicalRank = rank;
    if (!entry.item) entry.item = item;
    entry.score += opts.lexicalWeight / (k + rank);
  });

  const fused = Array.from(byId.values()).sort((a, b) => b.score - a.score);
  return opts.topK > 0 ? fused.slice(0, opts.topK) : fused;
}

/**
 * High-level helper: fuse an existing semantic ranking (ids, best-first) with a
 * BM25 lexical ranking computed over the given chunks, returning fused
 * ScoredItems best-first.
 */
export function hybridSearch(
  vectorRanking: Array<{ id: string }>,
  lexicalChunks: TextChunk[],
  query: string,
  options: Partial<FuseOptions & Bm25Options> = {},
): ScoredItem[] {
  const { k1, b, ...fuseOpts } = options;
  const lexical = bm25Search(lexicalChunks, query, lexicalChunks.length, { k1, b });
  const fused = fuse(
    vectorRanking.map((r) => ({ id: r.id })),
    lexical.map((l) => ({ id: l.id })),
    fuseOpts,
  );
  return fused.map((f) => ({ id: f.id, score: f.score }));
}

export default fuse;

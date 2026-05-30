// ─── Citations / Attribution ──────────────────────────────────────────────────
// Issue #600. Pure helpers to map retrieved chunks to citation markers (e.g.
// `[1]`) and produce a citations list (source + span + snippet) to attach to a
// response. Spans are read from chunk metadata (startOffset/endOffset) when
// available; otherwise null. All functions are pure & dependency-free.

import type { RetrievalResult } from "./retriever.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A chunk-like input for citation building. */
export interface CitableChunk {
  id: string;
  content: string;
  score?: number;
  /** Logical source identifier (doc id / url / path). */
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface Citation {
  /** 1-based marker number, matching inline `[n]` references. */
  marker: number;
  /** Source document identifier. */
  source: string;
  /** Originating chunk id. */
  chunkId: string;
  /** Character offsets into the source, or null if unknown. */
  span: { start: number; end: number } | null;
  /** Short snippet of the cited text. */
  snippet: string;
  /** Retrieval/rerank score, when available. */
  score?: number;
  /** Metadata carried from the chunk. */
  metadata?: Record<string, unknown>;
}

export interface BuildCitationsOptions {
  /** Maximum snippet length in characters. Default 160. */
  snippetLength: number;
  /**
   * Collapse chunks from the same source into one citation (span widened to
   * cover them). Default false (one citation per chunk).
   */
  dedupeBySource: boolean;
}

export const DEFAULT_CITATION_OPTIONS: BuildCitationsOptions = {
  snippetLength: 160,
  dedupeBySource: false,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSnippet(text: string, maxLen: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLen) return collapsed;
  return collapsed.slice(0, Math.max(0, maxLen - 1)).trimEnd() + "…";
}

function resolveSource(chunk: CitableChunk): string {
  if (chunk.source) return chunk.source;
  const metaSource = chunk.metadata?.["source"];
  if (typeof metaSource === "string" && metaSource) return metaSource;
  return chunk.id;
}

function resolveSpan(chunk: CitableChunk): { start: number; end: number } | null {
  const start = chunk.metadata?.["startOffset"];
  const end = chunk.metadata?.["endOffset"];
  if (typeof start === "number" && typeof end === "number") {
    return { start, end };
  }
  return null;
}

// ─── Build ────────────────────────────────────────────────────────────────────

/**
 * Build an ordered citations list. Marker numbers are assigned in input order,
 * so pass chunks ranked best-first.
 */
export function buildCitations(
  chunks: Array<CitableChunk | RetrievalResult>,
  options: Partial<BuildCitationsOptions> = {},
): Citation[] {
  const opts = { ...DEFAULT_CITATION_OPTIONS, ...options };

  if (opts.dedupeBySource) {
    const bySource = new Map<string, Citation>();
    for (const chunk of chunks) {
      const source = resolveSource(chunk);
      const span = resolveSpan(chunk);
      const existing = bySource.get(source);
      if (existing) {
        if (span && existing.span) {
          existing.span.start = Math.min(existing.span.start, span.start);
          existing.span.end = Math.max(existing.span.end, span.end);
        } else if (span && !existing.span) {
          existing.span = { ...span };
        }
        if (typeof chunk.score === "number") {
          existing.score = Math.max(existing.score ?? 0, chunk.score);
        }
      } else {
        bySource.set(source, {
          marker: bySource.size + 1,
          source,
          chunkId: chunk.id,
          span,
          snippet: makeSnippet(chunk.content, opts.snippetLength),
          ...(typeof chunk.score === "number" ? { score: chunk.score } : {}),
          ...(chunk.metadata ? { metadata: chunk.metadata } : {}),
        });
      }
    }
    return Array.from(bySource.values());
  }

  return chunks.map((chunk, i) => ({
    marker: i + 1,
    source: resolveSource(chunk),
    chunkId: chunk.id,
    span: resolveSpan(chunk),
    snippet: makeSnippet(chunk.content, opts.snippetLength),
    ...(typeof chunk.score === "number" ? { score: chunk.score } : {}),
    ...(chunk.metadata ? { metadata: chunk.metadata } : {}),
  }));
}

// ─── Render ───────────────────────────────────────────────────────────────────

/** Render an inline marker string for a citation, e.g. `[3]`. */
export function renderMarker(citation: Citation): string {
  return `[${citation.marker}]`;
}

/** Render a formatted references section, one line per citation. */
export function renderReferences(citations: Citation[]): string {
  return citations
    .map((c) => `[${c.marker}] ${c.source} — "${c.snippet}"`)
    .join("\n");
}

export interface AttributedResponse {
  /** The response text with a references section appended. */
  text: string;
  citations: Citation[];
}

/**
 * Attach citations to a response by appending a references section. Does not
 * mutate inputs. With no citations, returns the response unchanged.
 */
export function attachCitations(
  responseText: string,
  citations: Citation[],
  heading = "Sources",
): AttributedResponse {
  if (citations.length === 0) return { text: responseText, citations };
  return {
    text: `${responseText}\n\n${heading}:\n${renderReferences(citations)}`,
    citations,
  };
}

export default buildCitations;

// ─── Configurable Ingestion & Chunking ────────────────────────────────────────
// Issue #598. A configurable chunking-strategy layer (tokens / sentences /
// paragraphs / recursive) with overlap, lightweight metadata extraction, and a
// stable content hash per document and per chunk for idempotent ingestion.
//
// Builds on the existing recursive chunker (`chunkText`) for the "recursive"
// strategy, and adds deterministic sentence/paragraph/token strategies.
// Pure apart from Node's builtin `node:crypto`.

import { createHash } from "node:crypto";
import { chunkText, type TextChunk } from "./chunker.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type IngestionStrategy =
  | "tokens"
  | "sentences"
  | "paragraphs"
  | "recursive";

export interface IngestionOptions {
  /** Chunking strategy. Default: "recursive" (delegates to chunkText). */
  strategy: IngestionStrategy;
  /**
   * Target chunk size. Approximate tokens for "tokens"/"recursive"; a soft
   * character budget for "sentences"/"paragraphs".
   */
  chunkSize: number;
  /** Overlap between adjacent chunks (tokens for "tokens", else units). */
  overlap: number;
  /** Drop chunks whose trimmed length is below this many characters. */
  minChunkSize: number;
  /** Whether to extract & attach document metadata to each chunk. */
  extractMetadata: boolean;
}

export const DEFAULT_INGESTION_OPTIONS: IngestionOptions = {
  strategy: "recursive",
  chunkSize: 512,
  overlap: 64,
  minChunkSize: 1,
  extractMetadata: true,
};

export interface DocumentMetadata {
  title?: string;
  charCount: number;
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  /** Naive language guess: "en" or "unknown". */
  language: string;
  [key: string]: unknown;
}

export interface IngestedChunk extends TextChunk {
  /** Stable content hash of the chunk content (sha256 hex). */
  contentHash: string;
}

export interface IngestionResult {
  source: string;
  /** Stable content hash of the full document text. */
  documentHash: string;
  metadata: DocumentMetadata;
  chunks: IngestedChunk[];
}

// ─── Hashing ──────────────────────────────────────────────────────────────────

/** Compute a stable sha256 hex hash of text content. */
export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ─── Splitters ────────────────────────────────────────────────────────────────

/** Split text into sentences on terminal punctuation followed by whitespace. */
export function splitIntoSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Split text into paragraphs on blank lines. */
export function splitIntoParagraphs(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

const COMMON_EN_WORDS = new Set([
  "the", "and", "is", "in", "to", "of", "a", "that", "it", "for", "on",
  "with", "as", "are", "this",
]);

function guessLanguage(text: string): string {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "unknown";
  let hits = 0;
  for (const w of words) if (COMMON_EN_WORDS.has(w)) hits += 1;
  return hits / words.length > 0.05 ? "en" : "unknown";
}

/** Extract lightweight, deterministic metadata from a document. */
export function extractMetadata(
  text: string,
  extra: Record<string, unknown> = {},
): DocumentMetadata {
  const trimmed = text.trim();
  const words = trimmed.length === 0 ? [] : trimmed.split(/\s+/);
  const sentences = splitIntoSentences(trimmed);
  const paragraphs = splitIntoParagraphs(trimmed);
  const firstLine = trimmed.split(/\r?\n/, 1)[0]?.trim();
  const title =
    firstLine && firstLine.length > 0 && firstLine.length <= 120
      ? firstLine
      : undefined;

  return {
    ...(title ? { title } : {}),
    charCount: text.length,
    wordCount: words.length,
    sentenceCount: sentences.length,
    paragraphCount: paragraphs.length,
    language: guessLanguage(trimmed),
    ...extra,
  };
}

// ─── Strategy implementations ─────────────────────────────────────────────────

/**
 * Group already-split units into chunks under a soft character budget, with a
 * unit-level overlap (carry the last `overlap` units into the next chunk).
 */
function packUnits(units: string[], budget: number, overlap: number): string[] {
  if (units.length === 0) return [];
  const ov = Math.max(0, Math.min(overlap, Math.max(0, units.length - 1)));
  const chunks: string[] = [];
  let current: string[] = [];
  let curLen = 0;

  for (const unit of units) {
    const addLen = unit.length + (current.length > 0 ? 1 : 0);
    if (curLen + addLen > budget && current.length > 0) {
      chunks.push(current.join(" "));
      current = ov > 0 ? current.slice(-ov) : [];
      curLen = current.reduce((n, u) => n + u.length + 1, 0);
    }
    current.push(unit);
    curLen += addLen;
  }
  if (current.length > 0) chunks.push(current.join(" "));
  return chunks;
}

/**
 * Approximate-token chunking. A token is approximated as a whitespace-delimited
 * word. Produces overlapping chunks with accurate character offsets stored in
 * metadata.startOffset / metadata.endOffset.
 */
function chunkByTokens(
  text: string,
  size: number,
  overlap: number,
): Array<{ content: string; startOffset: number; endOffset: number }> {
  if (!text || text.trim().length === 0) return [];
  const sz = Math.max(1, Math.floor(size));
  const ov = Math.max(0, Math.min(Math.floor(overlap), sz - 1));
  const step = Math.max(1, sz - ov);

  const tokens: { start: number; end: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ start: m.index, end: m.index + m[0].length });
  }
  if (tokens.length === 0) return [];

  const out: Array<{ content: string; startOffset: number; endOffset: number }> = [];
  for (let i = 0; i < tokens.length; i += step) {
    const slice = tokens.slice(i, i + sz);
    if (slice.length === 0) break;
    const startOffset = slice[0].start;
    const endOffset = slice[slice.length - 1].end;
    out.push({ content: text.slice(startOffset, endOffset), startOffset, endOffset });
    if (i + sz >= tokens.length) break;
  }
  return out;
}

// ─── Ingest ───────────────────────────────────────────────────────────────────

/**
 * Ingest a document into hashed chunks with optional metadata.
 *
 * Idempotent: identical input text always yields the same `documentHash` and
 * the same per-chunk `contentHash` values, enabling change detection downstream
 * (see incremental.ts).
 */
export function ingestDocument(
  source: string,
  text: string,
  options: Partial<IngestionOptions> = {},
  extraMetadata: Record<string, unknown> = {},
): IngestionResult {
  const opts = { ...DEFAULT_INGESTION_OPTIONS, ...options };
  const documentHash = contentHash(text);

  const metadata = opts.extractMetadata
    ? extractMetadata(text, extraMetadata)
    : ({
        charCount: text.length,
        wordCount: 0,
        sentenceCount: 0,
        paragraphCount: 0,
        language: "unknown",
        ...extraMetadata,
      } as DocumentMetadata);

  const baseMeta: Record<string, unknown> = {
    ...(opts.extractMetadata ? metadata : {}),
    ...extraMetadata,
    source,
    documentHash,
  };

  let chunks: IngestedChunk[];

  if (opts.strategy === "recursive") {
    const tc = chunkText(text, {
      chunkSize: opts.chunkSize,
      overlap: opts.overlap,
      metadata: baseMeta,
    });
    chunks = tc
      .filter((c) => c.content.trim().length >= opts.minChunkSize)
      .map((c, index) => ({
        ...c,
        id: `${source}#${index}`,
        index,
        contentHash: contentHash(c.content),
      }));
  } else {
    let pieces: Array<{ content: string; startOffset?: number; endOffset?: number }>;
    if (opts.strategy === "tokens") {
      pieces = chunkByTokens(text, opts.chunkSize, opts.overlap);
    } else {
      const units =
        opts.strategy === "sentences"
          ? splitIntoSentences(text)
          : splitIntoParagraphs(text);
      pieces = packUnits(units, opts.chunkSize, opts.overlap).map((content) => ({ content }));
    }
    chunks = pieces
      .filter((p) => p.content.trim().length >= opts.minChunkSize)
      .map((p, index) => ({
        id: `${source}#${index}`,
        content: p.content,
        index,
        tokenCount: Math.ceil(p.content.length / 4),
        contentHash: contentHash(p.content),
        metadata: {
          ...baseMeta,
          chunkIndex: index,
          ...(p.startOffset !== undefined ? { startOffset: p.startOffset } : {}),
          ...(p.endOffset !== undefined ? { endOffset: p.endOffset } : {}),
        },
      }));
  }

  return { source, documentHash, metadata, chunks };
}

export default ingestDocument;

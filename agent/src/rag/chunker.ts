// ─── Text Chunker ───────────────────────────────────────────────────────────
// Recursive text splitter with configurable chunk size and overlap.
// Splits on natural boundaries: paragraphs → sentences → words.

import pino from "pino";

const logger = pino({ name: "rag-chunker" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChunkOptions {
  /** Target chunk size in tokens (approximate). Default: 512. */
  chunkSize?: number;
  /** Overlap between chunks in tokens. Default: 64. */
  overlap?: number;
  /** Metadata to attach to all chunks. */
  metadata?: Record<string, unknown>;
}

export interface TextChunk {
  id: string;
  content: string;
  index: number;
  tokenCount: number;
  metadata: Record<string, unknown>;
}

// ─── Separators ─────────────────────────────────────────────────────────────

const SEPARATORS = [
  "\n\n",    // Paragraphs
  "\n",      // Lines
  ". ",      // Sentences
  "? ",      // Questions
  "! ",      // Exclamations
  "; ",      // Semicolons
  ", ",      // Clauses
  " ",       // Words
];

// ─── Chunker ────────────────────────────────────────────────────────────────

/**
 * Split text into overlapping chunks of approximately `chunkSize` tokens.
 * Uses a recursive strategy: try the largest separator first, fall back to smaller ones.
 */
export function chunkText(text: string, options?: ChunkOptions): TextChunk[] {
  const chunkSize = options?.chunkSize ?? 512;
  const overlap = options?.overlap ?? 64;
  const metadata = options?.metadata ?? {};

  if (!text || text.trim().length === 0) return [];

  const chunks = recursiveSplit(text, chunkSize, overlap, SEPARATORS);

  const result: TextChunk[] = chunks.map((content, index) => ({
    id: `chunk_${index}`,
    content,
    index,
    tokenCount: estimateTokens(content),
    metadata: { ...metadata, chunkIndex: index },
  }));

  logger.debug(
    { totalChunks: result.length, chunkSize, overlap, textLength: text.length },
    "Text chunked",
  );

  return result;
}

// ─── Recursive Split ────────────────────────────────────────────────────────

function recursiveSplit(
  text: string,
  chunkSize: number,
  overlap: number,
  separators: string[],
): string[] {
  const tokenCount = estimateTokens(text);

  // Base case: text fits in one chunk
  if (tokenCount <= chunkSize) {
    return [text.trim()].filter((t) => t.length > 0);
  }

  // Find the best separator
  let separator = "";
  for (const sep of separators) {
    if (text.includes(sep)) {
      separator = sep;
      break;
    }
  }

  // If no separator found, force split by character count
  if (!separator) {
    return forceSplit(text, chunkSize, overlap);
  }

  // Split by the chosen separator
  const parts = text.split(separator);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const part of parts) {
    const candidate = currentChunk ? currentChunk + separator + part : part;

    if (estimateTokens(candidate) > chunkSize && currentChunk) {
      chunks.push(currentChunk.trim());

      // Apply overlap: keep the tail of the previous chunk
      const overlapText = getOverlapText(currentChunk, overlap);
      currentChunk = overlapText ? overlapText + separator + part : part;
    } else {
      currentChunk = candidate;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  // Recursively split any chunks that are still too large
  const result: string[] = [];
  const nextSeparators = separators.slice(separators.indexOf(separator) + 1);

  for (const chunk of chunks) {
    if (estimateTokens(chunk) > chunkSize * 1.5 && nextSeparators.length > 0) {
      result.push(...recursiveSplit(chunk, chunkSize, overlap, nextSeparators));
    } else {
      result.push(chunk);
    }
  }

  return result.filter((c) => c.length > 0);
}

function forceSplit(text: string, chunkSize: number, overlap: number): string[] {
  const charPerToken = 4;
  const chunkChars = chunkSize * charPerToken;
  const overlapChars = overlap * charPerToken;
  const chunks: string[] = [];

  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkChars, text.length);
    chunks.push(text.slice(start, end).trim());
    start = end - overlapChars;
    if (start >= text.length) break;
  }

  return chunks.filter((c) => c.length > 0);
}

function getOverlapText(text: string, overlapTokens: number): string {
  const charCount = overlapTokens * 4;
  if (text.length <= charCount) return text;
  return text.slice(-charCount);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

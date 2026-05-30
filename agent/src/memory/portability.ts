// ─── Memory Export / Import (Portability) ──────────────────────────────────
// Issue #539 — Export a user's/agent's memories to a versioned JSON envelope
// and import/validate it. The envelope is round-trippable: export -> import
// yields the same memory entries.
//
// Zod-validated at the boundary. Pure & dependency-free: serialization produces
// plain objects/JSON; persistence is left to the caller (an injectable saver is
// supported for convenience but not required).
//
// Additive & non-breaking: nothing runs unless invoked.

import { z } from "zod";
import { MemoryEntrySchema, type MemoryEntry } from "@karna/shared/types/memory.js";
import type { SaveMemoryInput } from "./store.js";

// ─── Envelope Schema ─────────────────────────────────────────────────────────

/** Current envelope version. Bump on breaking format changes. */
export const MEMORY_EXPORT_VERSION = 1 as const;

export const MemoryExportEnvelopeSchema = z.object({
  /** Format version for forward/backward compatibility checks. */
  version: z.literal(MEMORY_EXPORT_VERSION),
  /** Tool/app that produced the export. */
  kind: z.literal("karna.memory.export"),
  /** Owning agent id. */
  agentId: z.string().min(1),
  /** Optional user scope. */
  userId: z.string().min(1).optional(),
  /** Export timestamp (epoch ms). */
  exportedAt: z.number().int().positive(),
  /** The exported memory entries. */
  entries: z.array(MemoryEntrySchema),
  /** Optional free-form metadata (e.g. source host). */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type MemoryExportEnvelope = z.infer<typeof MemoryExportEnvelopeSchema>;

// ─── Export ───────────────────────────────────────────────────────────────

export interface ExportOptions {
  userId?: string;
  /** Override the export timestamp (injectable for deterministic tests). */
  exportedAt?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Build a versioned export envelope from a list of memory entries. Entries are
 * validated/normalized via {@link MemoryEntrySchema} so the envelope is always
 * schema-clean. Pure: does not mutate inputs.
 */
export function exportMemories(
  agentId: string,
  entries: MemoryEntry[],
  options?: ExportOptions,
): MemoryExportEnvelope {
  const normalized = entries.map((e) => MemoryEntrySchema.parse(e));
  const envelope: MemoryExportEnvelope = {
    version: MEMORY_EXPORT_VERSION,
    kind: "karna.memory.export",
    agentId,
    userId: options?.userId,
    exportedAt: options?.exportedAt ?? Date.now(),
    entries: normalized,
    metadata: options?.metadata,
  };
  // Validate the assembled envelope to guarantee round-trippability.
  return MemoryExportEnvelopeSchema.parse(envelope);
}

/** Serialize an export envelope to a JSON string. */
export function serializeExport(envelope: MemoryExportEnvelope, pretty = false): string {
  return JSON.stringify(envelope, null, pretty ? 2 : undefined);
}

// ─── Import / Validation ────────────────────────────────────────────────────

export interface ImportResult {
  ok: boolean;
  /** Parsed envelope when valid. */
  envelope?: MemoryExportEnvelope;
  /** Validation issues when invalid. */
  errors: string[];
}

/**
 * Validate and parse an export envelope from an unknown value (e.g. parsed
 * JSON). Never throws: returns a discriminated result with errors.
 */
export function importMemories(input: unknown): ImportResult {
  const parsed = MemoryExportEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`),
    };
  }
  return { ok: true, envelope: parsed.data, errors: [] };
}

/** Parse a JSON string into an envelope, validating along the way. */
export function deserializeImport(json: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    return { ok: false, errors: [`Invalid JSON: ${String(error)}`] };
  }
  return importMemories(raw);
}

// ─── Conversion to Save Inputs ───────────────────────────────────────────────

/**
 * Convert a validated envelope's entries into {@link SaveMemoryInput}s suitable
 * for re-persisting under the envelope's agent. Lifecycle fields (ids,
 * timestamps, access counts) are intentionally dropped so the target backend
 * assigns fresh ones — this is what makes import idempotent across stores.
 */
export function envelopeToSaveInputs(envelope: MemoryExportEnvelope): SaveMemoryInput[] {
  return envelope.entries.map((e) => ({
    agentId: envelope.agentId,
    content: e.content,
    summary: e.summary,
    source: e.source,
    priority: e.priority,
    category: e.category,
    tags: e.tags,
    embedding: e.embedding,
    sessionId: e.sessionId,
    userId: e.userId ?? envelope.userId,
    relatedMessageIds: e.relatedMessageIds,
    expiresAt: e.expiresAt,
  }));
}

export interface ImportSaver {
  save(input: SaveMemoryInput): Promise<MemoryEntry>;
}

/**
 * Convenience: import a validated envelope into a backend/store. Returns the
 * count of successfully saved entries. Per-entry failures are collected and do
 * not abort the import.
 */
export async function applyImport(
  envelope: MemoryExportEnvelope,
  saver: ImportSaver,
): Promise<{ saved: number; failed: number; errors: string[] }> {
  const inputs = envelopeToSaveInputs(envelope);
  let saved = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const input of inputs) {
    try {
      await saver.save(input);
      saved++;
    } catch (error) {
      failed++;
      errors.push(String(error));
    }
  }
  return { saved, failed, errors };
}

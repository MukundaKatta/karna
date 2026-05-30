// ─── Tamper-Evident Audit Log (Hash Chain) ─────────────────────────────────
//
// Issue #561 "Tamper-evident audit log".
//
// An append-only, hash-chained wrapper over the existing `AuditEvent` records
// produced by audit/logger.ts. Each record is linked to its predecessor via a
// `prevHash -> hash` chain (a lightweight blockchain-style ledger), so any
// after-the-fact mutation, reordering, insertion, or deletion of a record is
// detectable by recomputing the chain with `verifyChain()`.
//
// This is built ON TOP of `AuditLogger`/`AuditBackend` by COMPOSITION — it does
// NOT modify their existing API. You can either:
//   - use `HashChainAuditBackend` as a backend plugged into `AuditLogger`, or
//   - use the standalone `HashChain` to wrap records you already have.
//
// The hashing is deterministic (canonical JSON of the record fields plus the
// previous hash), using Node's built-in SHA-256 — no new dependencies.
//
// ──────────────────────────────────────────────────────────────────────────

import pino from "pino";
import { createHash } from "node:crypto";
import type {
  AuditEvent,
  AuditBackend,
  AuditQueryParams,
} from "./logger.js";

const logger = pino({ name: "audit-hash-chain" });

// ─── Types ────────────────────────────────────────────────────────────────

/** The genesis previous-hash value for the first record in a chain. */
export const GENESIS_HASH = "0".repeat(64);

/**
 * An audit event wrapped with chain linkage metadata.
 * `hash = sha256(canonical(event) + prevHash + sequence)`.
 */
export interface ChainedAuditRecord {
  /** Monotonic position in the chain, starting at 0. */
  sequence: number;
  /** Hash of the preceding record (GENESIS_HASH for the first record). */
  prevHash: string;
  /** Hash of this record (covers the event, prevHash, and sequence). */
  hash: string;
  /** The underlying audit event, untouched. */
  event: AuditEvent;
}

export interface ChainVerificationResult {
  valid: boolean;
  /** Number of records checked. */
  length: number;
  /**
   * When invalid, the sequence number of the first record that failed
   * verification; undefined when valid.
   */
  brokenAt?: number;
  /** Human-readable reason for the failure. */
  reason?: string;
}

// ─── Canonical hashing ──────────────────────────────────────────────────────

/**
 * Deterministically serialize an audit event for hashing. Object keys are
 * sorted recursively so logically-equal events always produce the same string,
 * regardless of insertion order.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

/**
 * Compute the hash for a record given its event, the previous hash, and its
 * sequence. Pure and deterministic.
 */
export function computeRecordHash(
  event: AuditEvent,
  prevHash: string,
  sequence: number,
): string {
  const payload = `${sequence}\n${prevHash}\n${canonicalize(event)}`;
  return createHash("sha256").update(payload, "utf-8").digest("hex");
}

// ─── Hash chain (standalone) ────────────────────────────────────────────────

/**
 * An in-memory, append-only hash chain over audit events. Use `append()` to add
 * events; the chain links each to the previous via SHA-256. `verifyChain()`
 * detects any tampering.
 */
export class HashChain {
  private readonly records: ChainedAuditRecord[] = [];

  /** Append an event, linking it to the current chain head. */
  append(event: AuditEvent): ChainedAuditRecord {
    const sequence = this.records.length;
    const prevHash = sequence === 0 ? GENESIS_HASH : this.records[sequence - 1]!.hash;
    const hash = computeRecordHash(event, prevHash, sequence);
    const record: ChainedAuditRecord = { sequence, prevHash, hash, event };
    this.records.push(record);
    return record;
  }

  /** The hash of the most recent record (GENESIS_HASH if empty). */
  get headHash(): string {
    return this.records.length === 0
      ? GENESIS_HASH
      : this.records[this.records.length - 1]!.hash;
  }

  get length(): number {
    return this.records.length;
  }

  /** Snapshot copy of all chained records. */
  getRecords(): ChainedAuditRecord[] {
    return this.records.map((r) => ({ ...r, event: { ...r.event } }));
  }

  /** Verify this chain's integrity. */
  verify(): ChainVerificationResult {
    return verifyChain(this.records);
  }
}

// ─── Verification ───────────────────────────────────────────────────────────

/**
 * Recompute the chain from scratch and confirm every record's `prevHash`,
 * `sequence`, and `hash` are consistent. Detects mutated payloads, reordering,
 * insertions, and deletions.
 */
export function verifyChain(records: readonly ChainedAuditRecord[]): ChainVerificationResult {
  let prevHash = GENESIS_HASH;

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;

    if (record.sequence !== i) {
      return {
        valid: false,
        length: records.length,
        brokenAt: i,
        reason: `sequence mismatch at index ${i}: expected ${i}, found ${record.sequence}`,
      };
    }

    if (record.prevHash !== prevHash) {
      return {
        valid: false,
        length: records.length,
        brokenAt: record.sequence,
        reason: `prevHash mismatch at sequence ${record.sequence}: chain link broken`,
      };
    }

    const expectedHash = computeRecordHash(record.event, record.prevHash, record.sequence);
    if (record.hash !== expectedHash) {
      return {
        valid: false,
        length: records.length,
        brokenAt: record.sequence,
        reason: `hash mismatch at sequence ${record.sequence}: record was tampered`,
      };
    }

    prevHash = record.hash;
  }

  return { valid: true, length: records.length };
}

// ─── Hash-chain audit backend (composition) ─────────────────────────────────

/**
 * An `AuditBackend` that records every written event into a hash chain while
 * optionally delegating to an inner backend (so existing log/file/db backends
 * keep working untouched). Plug it into `AuditLogger` alongside or in place of
 * the default backend:
 *
 *   const chain = new HashChainAuditBackend(new LogAuditBackend());
 *   const logger = new AuditLogger([chain]);
 *   // ... later ...
 *   chain.verify(); // tamper check
 */
export class HashChainAuditBackend implements AuditBackend {
  private readonly chain = new HashChain();
  private readonly inner?: AuditBackend;

  constructor(inner?: AuditBackend) {
    this.inner = inner;
  }

  async write(event: AuditEvent): Promise<void> {
    const record = this.chain.append(event);
    logger.debug(
      { auditId: event.id, sequence: record.sequence, hash: record.hash },
      "Chained audit record",
    );
    if (this.inner) {
      await this.inner.write(event);
    }
  }

  async query(params: AuditQueryParams): Promise<AuditEvent[]> {
    if (this.inner) {
      return this.inner.query(params);
    }
    // Fall back to querying the chain's own records.
    let results = this.chain.getRecords().map((r) => r.event);
    if (params.eventType) results = results.filter((e) => e.eventType === params.eventType);
    if (params.actorId) results = results.filter((e) => e.actorId === params.actorId);
    if (params.sessionId) results = results.filter((e) => e.sessionId === params.sessionId);
    if (params.since !== undefined) {
      const since = params.since;
      results = results.filter((e) => e.timestamp >= since);
    }
    return results.slice(-(params.limit ?? 100));
  }

  /** Snapshot of the chained records (for export / external verification). */
  getRecords(): ChainedAuditRecord[] {
    return this.chain.getRecords();
  }

  /** The current chain head hash. */
  get headHash(): string {
    return this.chain.headHash;
  }

  get length(): number {
    return this.chain.length;
  }

  /** Verify the integrity of the recorded chain. */
  verify(): ChainVerificationResult {
    return this.chain.verify();
  }
}

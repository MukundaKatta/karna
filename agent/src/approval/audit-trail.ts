// ─── Approval Audit Trail (Issue #591) ───────────────────────────────────────
//
// An append-only record of approval decisions (approve / deny / edit) carrying
// actor, timestamp, and toolCallId. The trail is queryable (by toolCallId,
// actor, decision, time range) and exportable (to a plain array or JSONL).
//
// Pure aside from a clock and an in-memory ring buffer, so it is fully testable.

import { z } from "zod";

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const ApprovalDecisionKindSchema = z.enum(["approve", "deny", "edit"]);
export type ApprovalDecisionKind = z.infer<typeof ApprovalDecisionKindSchema>;

export const AuditEntrySchema = z.object({
  /** The tool call this decision pertains to. */
  toolCallId: z.string().min(1),
  /** The kind of decision. */
  decision: ApprovalDecisionKindSchema,
  /** Who made the decision (user id / approver id). */
  actor: z.string().min(1),
  /** When the decision was recorded (epoch ms). */
  timestamp: z.number().int().nonnegative(),
  /** Optional free-text reason. */
  reason: z.string().optional(),
  /** Optional structured details (e.g. edited args diff for an "edit"). */
  details: z.record(z.unknown()).optional(),
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/** A new audit entry without the auto-populated timestamp. */
export type AuditEntryInput = Omit<AuditEntry, "timestamp"> & { timestamp?: number };

// ─── Query ──────────────────────────────────────────────────────────────────

export interface AuditQuery {
  toolCallId?: string;
  actor?: string;
  decision?: ApprovalDecisionKind;
  /** Inclusive lower bound on timestamp. */
  since?: number;
  /** Inclusive upper bound on timestamp. */
  until?: number;
}

export interface AuditTrailOptions {
  /** Max entries to retain (ring buffer). Default 5000. */
  maxEntries?: number;
  /** Clock override for deterministic tests. */
  now?: () => number;
}

const DEFAULT_MAX_ENTRIES = 5000;

/**
 * Append-only, in-memory audit trail of approval decisions.
 */
export class ApprovalAuditTrail {
  private readonly entries: AuditEntry[] = [];
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: AuditTrailOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  /**
   * Append a decision to the trail. The timestamp defaults to the configured
   * clock. The entry is validated and a frozen copy is stored.
   */
  record(input: AuditEntryInput): AuditEntry {
    const entry = AuditEntrySchema.parse({
      ...input,
      timestamp: input.timestamp ?? this.now(),
    });
    const frozen = Object.freeze(entry);
    this.entries.push(frozen);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    return frozen;
  }

  /** All entries in insertion order (oldest first). */
  all(): readonly AuditEntry[] {
    return [...this.entries];
  }

  /** Query the trail. Filters are ANDed; omitted filters match everything. */
  query(filter: AuditQuery = {}): AuditEntry[] {
    return this.entries.filter((e) => {
      if (filter.toolCallId !== undefined && e.toolCallId !== filter.toolCallId) return false;
      if (filter.actor !== undefined && e.actor !== filter.actor) return false;
      if (filter.decision !== undefined && e.decision !== filter.decision) return false;
      if (filter.since !== undefined && e.timestamp < filter.since) return false;
      if (filter.until !== undefined && e.timestamp > filter.until) return false;
      return true;
    });
  }

  /** All entries for a single tool call, oldest first. */
  forToolCall(toolCallId: string): AuditEntry[] {
    return this.query({ toolCallId });
  }

  /** Number of recorded entries. */
  get size(): number {
    return this.entries.length;
  }

  /** Export the trail as a plain array (safe to JSON.stringify). */
  export(): AuditEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  /** Export the trail as newline-delimited JSON (one entry per line). */
  exportJsonl(): string {
    return this.entries.map((e) => JSON.stringify(e)).join("\n");
  }
}

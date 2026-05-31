// ─── Edit-and-Continue Tool Arguments (Issue #590) ───────────────────────────
//
// Allows an approver to edit a pending tool call's arguments before the call
// continues. The edited args are re-validated against the tool's Zod
// `inputSchema` (reusing tools/validation.ts). Invalid edits are rejected and
// the original args are preserved. Both the original and edited args are
// recorded so the change is auditable.
//
// Pure: the edit operation is a pure function over (tool, original, edited).
// An optional ApprovalAuditTrail can be passed to record the "edit" decision.

import type { ToolDefinitionRuntime } from "../tools/registry.js";
import { validateToolInput } from "../tools/validation.js";
import type { ValidationIssue } from "../tools/validation.js";
import type { ApprovalAuditTrail } from "./audit-trail.js";

/** The result of attempting to edit a pending tool call's arguments. */
export type EditResult =
  | {
      ok: true;
      /** The validated (and possibly coerced/defaulted) edited args. */
      args: Record<string, unknown>;
      /** Whether the edited args differ from the original. */
      changed: boolean;
      /** Provenance of the args used to continue. */
      record: EditRecord;
    }
  | {
      ok: false;
      /** Model-/human-friendly rejection message. */
      error: string;
      issues: ValidationIssue[];
    };

/** Append-only provenance of an edit decision. */
export interface EditRecord {
  toolCallId: string;
  toolName: string;
  actor: string;
  originalArgs: Record<string, unknown>;
  editedArgs: Record<string, unknown>;
  changed: boolean;
  at: number;
}

export interface EditOptions {
  /** Who performed the edit (recorded for audit). */
  actor: string;
  /** Audit trail to record the "edit" decision into. */
  audit?: ApprovalAuditTrail;
  /** Clock override for deterministic tests. */
  now?: () => number;
  /** Optional reason carried into the audit entry. */
  reason?: string;
}

/**
 * Apply an approver's edited arguments to a pending tool call.
 *
 * The edited args are validated against the tool's `inputSchema` (if any). On
 * success the validated args (post-coercion/defaults) are returned along with a
 * provenance record. On failure the edit is rejected and nothing is recorded.
 *
 * Note: when the tool has no `inputSchema`, validation is a pass-through (matches
 * existing executor behavior), so the edited args are accepted as-is.
 */
export function editToolArgs(
  tool: ToolDefinitionRuntime,
  originalArgs: Record<string, unknown>,
  editedArgs: Record<string, unknown>,
  toolCallId: string,
  options: EditOptions
): EditResult {
  const validation = validateToolInput(tool, editedArgs);
  if (!validation.ok) {
    return { ok: false, error: validation.error, issues: validation.issues };
  }

  const validated = validation.data;
  const changed = !deepEqual(originalArgs, validated);
  const now = options.now ?? Date.now;

  const record: EditRecord = {
    toolCallId,
    toolName: tool.name,
    actor: options.actor,
    originalArgs,
    editedArgs: validated,
    changed,
    at: now(),
  };

  options.audit?.record({
    toolCallId,
    decision: "edit",
    actor: options.actor,
    timestamp: record.at,
    reason: options.reason,
    details: {
      toolName: tool.name,
      changed,
      originalArgs,
      editedArgs: validated,
    },
  });

  return { ok: true, args: validated, changed, record };
}

/** Order-independent structural equality for JSON-like values. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    return ak.every(
      (k) =>
        Object.prototype.hasOwnProperty.call(b, k) &&
        deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
    );
  }
  return false;
}

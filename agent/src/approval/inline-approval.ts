// ─── Channel Inline Approve/Deny Correlation (Issue #588) ─────────────────────
//
// A pure correlation layer that lets messaging-channel adapters render an inline
// approve/deny prompt and correlate an inbound decision back to the waiting
// action. It mints an opaque token for a pending action, and resolves an inbound
// (token, decision) pair back to that action — with expiry and single-use
// semantics.
//
// No channel SDK calls live here; adapters embed the token in their UI (button
// payload, reply keyword, etc.) and hand inbound decisions back to `resolve`.
//
// Side effects are limited to an in-memory map and a clock, so it is testable.

import { randomUUID } from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export type InlineDecision = "approve" | "deny";

/** A pending action awaiting an inline decision. */
export interface PendingAction<T = unknown> {
  /** Opaque token embedded into the channel UI. */
  token: string;
  /** The tool call this decision pertains to. */
  toolCallId: string;
  /** Channel the prompt was sent to (e.g. "telegram", "slack"). */
  channel: string;
  /** Arbitrary adapter payload to recover when resolving (e.g. messageId). */
  payload?: T;
  /** When the action was registered (epoch ms). */
  createdAt: number;
  /** When the token expires (epoch ms). */
  expiresAt: number;
}

/** Outcome of resolving an inbound (token, decision). */
export type ResolveOutcome<T = unknown> =
  | { ok: true; decision: InlineDecision; action: PendingAction<T> }
  | { ok: false; reason: "unknown-token" | "expired" | "already-resolved" };

export interface InlineApprovalOptions {
  /** Default token TTL in ms. Default 5 minutes. */
  defaultTtlMs?: number;
  /** Clock override for deterministic tests. */
  now?: () => number;
  /** Token generator override (default crypto.randomUUID). */
  generateToken?: () => string;
}

const DEFAULT_TTL_MS = 300_000;

/**
 * In-memory correlator mapping opaque tokens to pending approval actions.
 *
 * Tokens are single-use: a successful resolve consumes the action. Expired
 * tokens never resolve and are swept lazily.
 */
export class InlineApprovalCorrelator<T = unknown> {
  private readonly pending = new Map<string, PendingAction<T>>();
  /** Index from toolCallId → token, to support cancellation by tool call. */
  private readonly byToolCall = new Map<string, string>();
  private readonly defaultTtlMs: number;
  private readonly now: () => number;
  private readonly generateToken: () => string;

  constructor(options: InlineApprovalOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
    this.generateToken = options.generateToken ?? (() => randomUUID());
  }

  /**
   * Register a pending action and mint an opaque token for it. The returned
   * token should be embedded into the channel's inline UI.
   */
  register(input: {
    toolCallId: string;
    channel: string;
    payload?: T;
    ttlMs?: number;
  }): PendingAction<T> {
    const createdAt = this.now();
    const token = this.generateToken();
    const action: PendingAction<T> = {
      token,
      toolCallId: input.toolCallId,
      channel: input.channel,
      payload: input.payload,
      createdAt,
      expiresAt: createdAt + (input.ttlMs ?? this.defaultTtlMs),
    };
    this.pending.set(token, action);
    this.byToolCall.set(input.toolCallId, token);
    return action;
  }

  /**
   * Resolve an inbound (token, decision). On success the action is consumed and
   * returned. On failure a reason is given (unknown / expired / already-resolved).
   */
  resolve(token: string, decision: InlineDecision): ResolveOutcome<T> {
    const action = this.pending.get(token);
    if (!action) {
      return { ok: false, reason: "unknown-token" };
    }
    if (this.now() > action.expiresAt) {
      this.discard(action);
      return { ok: false, reason: "expired" };
    }
    this.discard(action);
    return { ok: true, decision, action };
  }

  /** Look up a pending (non-consumed) action by token, if still valid. */
  peek(token: string): PendingAction<T> | undefined {
    const action = this.pending.get(token);
    if (!action) return undefined;
    if (this.now() > action.expiresAt) return undefined;
    return action;
  }

  /** Cancel a pending action by tool call id (e.g. resolved out-of-band). */
  cancelByToolCall(toolCallId: string): boolean {
    const token = this.byToolCall.get(toolCallId);
    if (!token) return false;
    const action = this.pending.get(token);
    if (action) this.discard(action);
    else this.byToolCall.delete(toolCallId);
    return true;
  }

  /** Remove all expired tokens; returns the number swept. */
  sweepExpired(): number {
    const now = this.now();
    let swept = 0;
    for (const action of [...this.pending.values()]) {
      if (now > action.expiresAt) {
        this.discard(action);
        swept++;
      }
    }
    return swept;
  }

  /** Number of currently-registered (not necessarily unexpired) actions. */
  get size(): number {
    return this.pending.size;
  }

  private discard(action: PendingAction<T>): void {
    this.pending.delete(action.token);
    if (this.byToolCall.get(action.toolCallId) === action.token) {
      this.byToolCall.delete(action.toolCallId);
    }
  }
}

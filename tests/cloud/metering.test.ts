import { describe, expect, it } from "vitest";
import type { UsageRecord } from "@karna/payments";
import {
  meteringKey,
  generateMeteringEvents,
  dedupeMeteringEvents,
  aggregateMeteringEvents,
  reconcileTotals,
  reconcileUsage,
  METER_DIMENSIONS,
  type MeteringEvent,
  type BillingUsageProvider,
  type ProviderReportedUsage,
} from "../../apps/cloud/src/billing/metering.js";

function record(partial: Partial<UsageRecord>): UsageRecord {
  return {
    agentId: "agent-1",
    channel: "api",
    messages: 0,
    tokensIn: 0,
    tokensOut: 0,
    date: "2026-05-30",
    ...partial,
  };
}

// ─── Idempotency keys ─────────────────────────────────────────────────────────

describe("meteringKey", () => {
  it("is deterministic for identical inputs", () => {
    expect(meteringKey("a", "2026-05-30", "messages")).toBe(meteringKey("a", "2026-05-30", "messages"));
  });

  it("differs across agent, date, and dimension", () => {
    const base = meteringKey("a", "2026-05-30", "messages");
    expect(meteringKey("b", "2026-05-30", "messages")).not.toBe(base);
    expect(meteringKey("a", "2026-05-31", "messages")).not.toBe(base);
    expect(meteringKey("a", "2026-05-30", "tokens_in")).not.toBe(base);
  });

  it("escapes delimiters so values cannot forge a colliding key", () => {
    expect(meteringKey("a:b", "2026-05-30", "messages")).not.toBe(meteringKey("a", "b:2026-05-30", "messages"));
  });
});

// ─── Event generation + idempotency ───────────────────────────────────────────

describe("generateMeteringEvents", () => {
  it("emits one event per non-zero dimension with stable keys", () => {
    const events = generateMeteringEvents([record({ messages: 3, tokensIn: 100, tokensOut: 50 })]);
    expect(events).toHaveLength(3);
    const dims = events.map((e) => e.dimension).sort();
    expect(dims).toEqual([...METER_DIMENSIONS].sort());
    for (const e of events) {
      expect(e.idempotencyKey).toBe(meteringKey(e.agentId, e.date, e.dimension));
    }
  });

  it("skips zero-quantity dimensions", () => {
    const events = generateMeteringEvents([record({ messages: 2, tokensIn: 0, tokensOut: 0 })]);
    expect(events).toHaveLength(1);
    expect(events[0]!.dimension).toBe("messages");
    expect(events[0]!.quantity).toBe(2);
  });

  it("merges records sharing the same agent+date (idempotent against partial duplicates)", () => {
    const events = generateMeteringEvents([
      record({ messages: 1, tokensIn: 10 }),
      record({ messages: 2, tokensOut: 5 }),
    ]);
    const byDim = Object.fromEntries(events.map((e) => [e.dimension, e.quantity]));
    expect(byDim).toEqual({ messages: 3, tokens_in: 10, tokens_out: 5 });
  });

  it("is order-independent and deterministic in output ordering", () => {
    const a = generateMeteringEvents([
      record({ agentId: "z", messages: 1 }),
      record({ agentId: "a", messages: 1 }),
    ]);
    const b = generateMeteringEvents([
      record({ agentId: "a", messages: 1 }),
      record({ agentId: "z", messages: 1 }),
    ]);
    expect(a).toEqual(b);
    expect(a.map((e) => e.agentId)).toEqual(["a", "z"]);
  });
});

describe("dedupeMeteringEvents", () => {
  it("keeps the last event per idempotency key", () => {
    const key = meteringKey("agent-1", "2026-05-30", "messages");
    const events: MeteringEvent[] = [
      { idempotencyKey: key, agentId: "agent-1", date: "2026-05-30", dimension: "messages", quantity: 1 },
      { idempotencyKey: key, agentId: "agent-1", date: "2026-05-30", dimension: "messages", quantity: 9 },
    ];
    const deduped = dedupeMeteringEvents(events);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.quantity).toBe(9);
  });
});

// ─── Aggregation ──────────────────────────────────────────────────────────────

describe("aggregateMeteringEvents", () => {
  it("aggregates totals and per-agent totals", () => {
    const events = generateMeteringEvents([
      record({ agentId: "a", messages: 2, tokensIn: 100, tokensOut: 40 }),
      record({ agentId: "b", messages: 5, tokensIn: 10, tokensOut: 1 }),
    ]);
    const agg = aggregateMeteringEvents(events);
    expect(agg.totals).toEqual({ messages: 7, tokensIn: 110, tokensOut: 41 });
    expect(agg.byAgent["a"]).toEqual({ messages: 2, tokensIn: 100, tokensOut: 40 });
    expect(agg.byAgent["b"]).toEqual({ messages: 5, tokensIn: 10, tokensOut: 1 });
  });

  it("does not double-count duplicate idempotency keys", () => {
    const events = generateMeteringEvents([record({ messages: 3, tokensIn: 9 })]);
    const agg = aggregateMeteringEvents([...events, ...events]);
    expect(agg.totals).toEqual({ messages: 3, tokensIn: 9, tokensOut: 0 });
    expect(agg.eventCount).toBe(events.length);
  });
});

// ─── Reconciliation ───────────────────────────────────────────────────────────

describe("reconcileTotals", () => {
  it("reports reconciled when internal matches provider exactly", () => {
    const result = reconcileTotals(
      { messages: 10, tokensIn: 100, tokensOut: 50 },
      { messages: 10, tokensIn: 100, tokensOut: 50 },
    );
    expect(result.reconciled).toBe(true);
    expect(result.discrepancies).toEqual([]);
  });

  it("lists only the dimensions that differ, with signed deltas", () => {
    const result = reconcileTotals(
      { messages: 10, tokensIn: 100, tokensOut: 50 },
      { messages: 10, tokensIn: 90, tokensOut: 55 },
    );
    expect(result.reconciled).toBe(false);
    expect(result.discrepancies).toEqual([
      { dimension: "tokens_in", internal: 100, provider: 90, delta: 10 },
      { dimension: "tokens_out", internal: 50, provider: 55, delta: -5 },
    ]);
  });

  it("honors a tolerance for acceptable drift", () => {
    const result = reconcileTotals(
      { messages: 100, tokensIn: 0, tokensOut: 0 },
      { messages: 98, tokensIn: 0, tokensOut: 0 },
      2,
    );
    expect(result.reconciled).toBe(true);
  });
});

describe("reconcileUsage", () => {
  it("fetches reported usage from an injected provider and compares", async () => {
    const reported: ProviderReportedUsage = { messages: 7, tokensIn: 110, tokensOut: 41 };
    let receivedPeriod: unknown;
    const provider: BillingUsageProvider = {
      async getReportedUsage(period) {
        receivedPeriod = period;
        return reported;
      },
    };

    const events = generateMeteringEvents([
      record({ agentId: "a", messages: 2, tokensIn: 100, tokensOut: 40 }),
      record({ agentId: "b", messages: 5, tokensIn: 10, tokensOut: 1 }),
    ]);
    const agg = aggregateMeteringEvents(events);

    const result = await reconcileUsage(agg.totals, provider, {
      startDate: "2026-05-01",
      endDate: "2026-05-30",
    });

    expect(receivedPeriod).toMatchObject({ startDate: "2026-05-01", endDate: "2026-05-30" });
    expect(result.reconciled).toBe(true);
    expect(result.provider).toEqual(reported);
  });
});

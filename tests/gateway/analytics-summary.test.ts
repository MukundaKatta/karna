import { describe, expect, it } from "vitest";
import type { Session } from "@karna/shared/types/session.js";
import type { Trace } from "../../gateway/src/observability/trace-collector.js";
import {
  buildAnalyticsSummary,
  getAnalyticsWindowStart,
  parseAnalyticsPeriod,
} from "../../gateway/src/analytics/summary.js";

describe("analytics summary", () => {
  it("builds live overview, latency, and breakdowns from sessions and traces", () => {
    const now = Date.parse("2026-04-22T18:00:00.000Z");
    const since = getAnalyticsWindowStart(7, now);

    const sessions: Session[] = [
      {
        id: "session-1",
        channelType: "slack",
        channelId: "channel-1",
        userId: "user-1",
        status: "active",
        createdAt: now - 5_000,
        updatedAt: now - 1_000,
        expiresAt: now + 3_600_000,
        metadata: {},
        stats: {
          messageCount: 4,
          totalInputTokens: 220,
          totalOutputTokens: 180,
          totalCostUsd: 0.24,
        },
      },
      {
        id: "session-2",
        channelType: "discord",
        channelId: "channel-2",
        userId: "user-2",
        status: "active",
        createdAt: now - 10_000,
        updatedAt: now - 2_000,
        expiresAt: now + 3_600_000,
        metadata: {},
        stats: {
          messageCount: 2,
          totalInputTokens: 80,
          totalOutputTokens: 40,
          totalCostUsd: 0.09,
        },
      },
    ];

    const traces: Trace[] = [
      {
        traceId: "trace-1",
        sessionId: "session-1",
        agentId: "karna-coder",
        startedAt: since + 60_000,
        endedAt: since + 62_000,
        durationMs: 2_000,
        model: "claude-sonnet-4",
        inputTokens: 120,
        outputTokens: 80,
        costUsd: 0.12,
        toolCalls: 2,
        success: true,
        spans: [
          {
            spanId: "span-1",
            name: "web_search",
            kind: "tool",
            startedAt: since + 60_500,
            endedAt: since + 60_900,
            durationMs: 400,
            status: "ok",
            attributes: {},
            events: [],
          },
          {
            spanId: "span-2",
            name: "file_read",
            kind: "tool",
            startedAt: since + 61_000,
            endedAt: since + 61_200,
            durationMs: 200,
            status: "ok",
            attributes: {},
            events: [],
          },
        ],
      },
      {
        traceId: "trace-2",
        sessionId: "session-2",
        agentId: "karna-coder",
        startedAt: since + 120_000,
        endedAt: since + 124_000,
        durationMs: 4_000,
        model: "claude-sonnet-4",
        inputTokens: 60,
        outputTokens: 40,
        costUsd: 0.07,
        toolCalls: 1,
        success: false,
        error: "tool failed",
        spans: [
          {
            spanId: "span-3",
            name: "web_search",
            kind: "tool",
            startedAt: since + 120_500,
            endedAt: since + 121_300,
            durationMs: 800,
            status: "error",
            attributes: {},
            events: [],
          },
        ],
      },
      {
        traceId: "trace-3",
        sessionId: "session-2",
        agentId: "karna-general",
        startedAt: since + 180_000,
        endedAt: since + 181_500,
        durationMs: 1_500,
        model: "gpt-4o",
        inputTokens: 30,
        outputTokens: 20,
        costUsd: 0.03,
        toolCalls: 0,
        success: true,
        spans: [],
      },
    ];

    const summary = buildAnalyticsSummary({
      sessions,
      connectedClients: 3,
      metrics: { requests: 42 },
      traces,
      sessionsCreated: 5,
      periodDays: 7,
      now,
    });

    expect(summary.overview).toMatchObject({
      activeSessions: 2,
      activeConnections: 3,
      totalMessages: 6,
      totalInputTokens: 300,
      totalOutputTokens: 220,
      totalCostUsd: 0.33,
    });
    expect(summary.sessionsByChannel).toEqual({
      slack: 1,
      discord: 1,
    });
    expect(summary.window).toMatchObject({
      period: "7d",
      since,
      messages: 3,
      tokens: 350,
      costUsd: 0.22,
      toolCalls: 3,
      errors: 1,
      sessionsCreated: 5,
      activeAgents: 2,
    });
    expect(summary.latency.totalTraces).toBe(3);
    expect(summary.latency.avgDurationMs).toBe(2500);
    expect(summary.latency.p95DurationMs).toBe(4000);
    expect(summary.latency.errorRate).toBeCloseTo(1 / 3);
    expect(summary.latency.toolSuccessRate).toBeCloseTo(2 / 3);
    expect(summary.topTools[0]).toMatchObject({
      name: "web_search",
      count: 2,
      failed: 1,
      avgDurationMs: 600,
    });
    expect(summary.models[0]).toMatchObject({
      model: "claude-sonnet-4",
      traces: 2,
      tokens: 300,
      costUsd: 0.19,
      errors: 1,
    });
    expect(summary.agents[0]).toMatchObject({
      agentId: "karna-coder",
      traces: 2,
      tokens: 300,
      costUsd: 0.19,
      errors: 1,
    });
  });

  it("parses supported analytics periods", () => {
    expect(parseAnalyticsPeriod(undefined)).toBe(7);
    expect(parseAnalyticsPeriod("14d")).toBe(14);
    expect(parseAnalyticsPeriod("30d")).toBe(30);
    expect(parseAnalyticsPeriod("90d")).toBeNull();
  });
});

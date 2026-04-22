import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchTrace,
  fetchTraces,
  fetchTraceStats,
} from "../../apps/cli/src/lib/traces.js";

describe("CLI trace helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds trace list queries from filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ traces: [], total: 0, active: 0, filter: {} }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchTraces("http://localhost:18789", {
      sessionId: "session-1",
      includeActive: true,
      hasErrors: true,
      minDurationMs: 5000,
      limit: 10,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:18789/api/traces?sessionId=session-1&limit=10&minDurationMs=5000&includeActive=true&hasErrors=true",
    );
  });

  it("fetches trace detail and stats", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          trace: {
            traceId: "trace-1",
            sessionId: "session-1",
            agentId: "agent-1",
            startedAt: Date.now(),
            model: "",
            inputTokens: 1,
            outputTokens: 2,
            costUsd: 0,
            toolCalls: 0,
            success: true,
            spans: [],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          stats: {
            totalTraces: 1,
            avgDurationMs: 10,
            p50DurationMs: 10,
            p95DurationMs: 10,
            p99DurationMs: 10,
            totalTokens: 3,
            totalCostUsd: 0,
            toolSuccessRate: 1,
            errorRate: 0,
            tracesPerMinute: 1,
          },
          activeTraces: 0,
          storedTraces: 1,
          periodMs: 60000,
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const trace = await fetchTrace("http://localhost:18789", "trace-1");
    const stats = await fetchTraceStats("http://localhost:18789", 60000);

    expect(trace.traceId).toBe("trace-1");
    expect(stats.stats.totalTraces).toBe(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:18789/api/traces/trace-1",
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:18789/api/traces/stats?periodMs=60000",
    );
  });
});

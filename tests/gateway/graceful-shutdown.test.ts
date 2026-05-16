import { describe, expect, it, vi } from "vitest";
import {
  buildShutdownNotice,
  closeClientsForShutdown,
  notifyClientsOfShutdown,
  trackInFlight,
  waitForInFlight,
} from "../../gateway/src/shutdown/graceful.js";
import type { ConnectedClient } from "../../gateway/src/protocol/handler.js";

function createClient(): ConnectedClient & {
  sent: string[];
  closed: Array<{ code: number; reason: string }>;
} {
  const sent: string[] = [];
  const closed: Array<{ code: number; reason: string }> = [];

  return {
    ws: {
      send(message: string) {
        sent.push(message);
      },
      close(code: number, reason: string) {
        closed.push({ code, reason });
      },
    } as ConnectedClient["ws"],
    auth: null,
    sessionIds: new Set(),
    sent,
    closed,
  };
}

describe("graceful shutdown helpers", () => {
  it("builds server.shutdown notices for clients", () => {
    const notice = buildShutdownNotice("SIGTERM", 30_000);

    expect(notice.type).toBe("server.shutdown");
    expect(notice.payload).toMatchObject({
      signal: "SIGTERM",
      timeoutMs: 30_000,
      retryable: true,
    });
  });

  it("notifies clients before closing them with Going Away", () => {
    const first = createClient();
    const second = createClient();
    const clients = new Map<string, ConnectedClient>([
      ["first", first],
      ["second", second],
    ]);

    expect(notifyClientsOfShutdown(clients.values(), "SIGINT", 10_000)).toBe(2);
    expect(JSON.parse(first.sent[0] ?? "{}")).toMatchObject({
      type: "server.shutdown",
      payload: { signal: "SIGINT", timeoutMs: 10_000 },
    });

    expect(closeClientsForShutdown(clients)).toBe(2);
    expect(first.closed).toEqual([{ code: 1001, reason: "Server shutting down" }]);
    expect(second.closed).toEqual([{ code: 1001, reason: "Server shutting down" }]);
    expect(clients.size).toBe(0);
  });

  it("waits for in-flight work and reports timeout when draining takes too long", async () => {
    vi.useFakeTimers();
    const inFlight = new Set<Promise<unknown>>();
    let finish!: () => void;
    const operation = new Promise<void>((resolve) => {
      finish = resolve;
    });

    trackInFlight(inFlight, operation);
    expect(inFlight.size).toBe(1);

    const completed = waitForInFlight(inFlight, 1_000);
    finish();
    await expect(completed).resolves.toBe("completed");
    expect(inFlight.size).toBe(0);

    const never = new Promise<void>(() => {});
    trackInFlight(inFlight, never);
    const timedOut = waitForInFlight(inFlight, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(timedOut).resolves.toBe("timeout");
    expect(inFlight.size).toBe(1);
    vi.useRealTimers();
  });
});

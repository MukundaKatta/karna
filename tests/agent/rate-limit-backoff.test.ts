import { describe, it, expect } from "vitest";
import {
  parseRateLimitHeaders,
  computeBackoff,
  RequestQueue,
  QueueFullError,
  retryWithBackoff,
} from "../../agent/src/models/rate-limit-backoff.js";

// ─── Header parsing ─────────────────────────────────────────────────────────

describe("parseRateLimitHeaders", () => {
  it("parses numeric Retry-After (seconds → ms)", () => {
    const r = parseRateLimitHeaders({ "retry-after": "5" });
    expect(r.retryAfterMs).toBe(5000);
    expect(r.limited).toBe(true);
  });

  it("is case-insensitive on header names", () => {
    const r = parseRateLimitHeaders({ "Retry-After": "2.5" });
    expect(r.retryAfterMs).toBe(2500);
  });

  it("parses HTTP-date Retry-After relative to injected now", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const future = "Thu, 01 Jan 2026 00:00:10 GMT";
    const r = parseRateLimitHeaders({ "retry-after": future }, now);
    expect(r.retryAfterMs).toBe(10_000);
    expect(r.resetAtMs).toBe(Date.parse(future));
  });

  it("reads remaining/limit and flags limited when remaining is 0", () => {
    const r = parseRateLimitHeaders({
      "x-ratelimit-remaining": "0",
      "x-ratelimit-limit": "100",
    });
    expect(r.remaining).toBe(0);
    expect(r.limit).toBe(100);
    expect(r.limited).toBe(true);
  });

  it("treats a small reset value as a delta in seconds", () => {
    const now = 1_000_000;
    const r = parseRateLimitHeaders({ "x-ratelimit-reset": "30" }, now);
    expect(r.resetAtMs).toBe(now + 30_000);
    expect(r.retryAfterMs).toBe(30_000);
  });

  it("treats a large reset value as an absolute epoch (seconds)", () => {
    const now = 1_700_000_000_000;
    const r = parseRateLimitHeaders({ "x-ratelimit-reset": "1700000050" }, now);
    expect(r.resetAtMs).toBe(1_700_000_050_000);
    expect(r.retryAfterMs).toBe(50_000);
  });

  it("supports a Headers-like get() interface", () => {
    const headers = {
      get(name: string): string | null {
        return name.toLowerCase() === "retry-after" ? "3" : null;
      },
    };
    const r = parseRateLimitHeaders(headers);
    expect(r.retryAfterMs).toBe(3000);
  });

  it("returns not-limited for empty headers", () => {
    const r = parseRateLimitHeaders({});
    expect(r.limited).toBe(false);
    expect(r.retryAfterMs).toBeUndefined();
  });
});

// ─── Backoff ────────────────────────────────────────────────────────────────

describe("computeBackoff", () => {
  it("is deterministic exponential with no jitter", () => {
    const opts = { baseMs: 100, factor: 2, jitter: "none" as const };
    expect(computeBackoff(0, opts)).toBe(100);
    expect(computeBackoff(1, opts)).toBe(200);
    expect(computeBackoff(2, opts)).toBe(400);
  });

  it("caps at maxMs", () => {
    expect(computeBackoff(10, { baseMs: 1000, factor: 2, maxMs: 5000, jitter: "none" })).toBe(5000);
  });

  it("full jitter stays within [0, computed]", () => {
    const rand = () => 0.999999;
    const d = computeBackoff(3, { baseMs: 100, factor: 2, maxMs: 100_000, jitter: "full", random: rand });
    // computed = 100 * 2^3 = 800; full jitter <= 800
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(800);
  });

  it("full jitter with random=0 yields 0", () => {
    const d = computeBackoff(3, { baseMs: 100, factor: 2, jitter: "full", random: () => 0 });
    expect(d).toBe(0);
  });

  it("equal jitter stays within [computed/2, computed]", () => {
    const computed = 800; // 100 * 2^3
    const low = computeBackoff(3, { baseMs: 100, factor: 2, maxMs: 1e6, jitter: "equal", random: () => 0 });
    const high = computeBackoff(3, { baseMs: 100, factor: 2, maxMs: 1e6, jitter: "equal", random: () => 0.999999 });
    expect(low).toBe(computed / 2);
    expect(high).toBeLessThanOrEqual(computed);
    expect(high).toBeGreaterThanOrEqual(computed / 2);
  });

  it("honors retryAfterMs as a floor even above the cap", () => {
    const d = computeBackoff(0, { baseMs: 100, maxMs: 1000, jitter: "none", retryAfterMs: 9000 });
    expect(d).toBe(9000);
  });

  it("clamps negative attempts to attempt 0", () => {
    expect(computeBackoff(-3, { baseMs: 100, factor: 2, jitter: "none" })).toBe(100);
  });
});

// ─── Request queue ──────────────────────────────────────────────────────────

describe("RequestQueue", () => {
  it("limits concurrency", async () => {
    const queue = new RequestQueue({ concurrency: 2 });
    let active = 0;
    let maxActive = 0;
    const make = () => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return active;
    };

    await Promise.all([
      queue.enqueue(make()),
      queue.enqueue(make()),
      queue.enqueue(make()),
      queue.enqueue(make()),
    ]);

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("preserves FIFO start order with concurrency 1", async () => {
    const queue = new RequestQueue({ concurrency: 1 });
    const startOrder: number[] = [];
    const tasks = [0, 1, 2, 3].map((i) => () =>
      new Promise<number>((resolve) => {
        startOrder.push(i);
        setTimeout(() => resolve(i), 1);
      }),
    );

    const results = await Promise.all(tasks.map((t) => queue.enqueue(t)));
    expect(startOrder).toEqual([0, 1, 2, 3]);
    expect(results).toEqual([0, 1, 2, 3]);
  });

  it("rejects when queue depth is exceeded", async () => {
    const queue = new RequestQueue({ concurrency: 1, maxQueueDepth: 1 });
    const block = new Promise<void>((r) => setTimeout(r, 20));

    const p1 = queue.enqueue(() => block.then(() => "a")); // starts running
    const p2 = queue.enqueue(() => Promise.resolve("b")); // fills the 1 waiting slot
    // Third should overflow the waiting queue.
    await expect(queue.enqueue(() => Promise.resolve("c"))).rejects.toBeInstanceOf(QueueFullError);

    await Promise.all([p1, p2]);
  });

  it("reports active and pending counts", async () => {
    const queue = new RequestQueue({ concurrency: 1 });
    const gate = new Promise<void>((r) => setTimeout(r, 15));
    const p1 = queue.enqueue(() => gate.then(() => 1));
    const p2 = queue.enqueue(() => Promise.resolve(2));

    // Allow the microtask pump to start the first task.
    await new Promise((r) => setTimeout(r, 0));
    expect(queue.activeCount).toBe(1);
    expect(queue.pendingCount).toBe(1);

    await Promise.all([p1, p2]);
    await queue.onIdle();
    expect(queue.activeCount).toBe(0);
    expect(queue.pendingCount).toBe(0);
  });

  it("propagates task rejection to its caller", async () => {
    const queue = new RequestQueue({ concurrency: 1 });
    await expect(queue.enqueue(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });
});

// ─── Retry orchestration ────────────────────────────────────────────────────

describe("retryWithBackoff", () => {
  it("returns immediately on success without sleeping", async () => {
    const sleeps: number[] = [];
    const result = await retryWithBackoff(async () => "ok", {
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(result).toBe("ok");
    expect(sleeps).toEqual([]);
  });

  it("retries up to maxAttempts then rethrows the last error", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls++;
          throw new Error(`fail-${calls}`);
        },
        {
          maxAttempts: 3,
          baseMs: 100,
          factor: 2,
          jitter: "none",
          sleep: async (ms) => void sleeps.push(ms),
        },
      ),
    ).rejects.toThrow("fail-3");
    expect(calls).toBe(3);
    // Slept between attempts 0→1 and 1→2 only.
    expect(sleeps).toEqual([100, 200]);
  });

  it("applies a server retry-after floor from shouldRetry", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls++;
        if (calls < 2) throw new Error("rate limited");
        return "done";
      },
      {
        baseMs: 100,
        jitter: "none",
        sleep: async (ms) => void sleeps.push(ms),
        shouldRetry: () => parseRateLimitHeaders({ "retry-after": "7" }),
      },
    );
    expect(result).toBe("done");
    expect(sleeps).toEqual([7000]);
  });

  it("aborts immediately when shouldRetry returns false", async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls++;
          throw new Error("nope");
        },
        { maxAttempts: 5, shouldRetry: () => false, sleep: async () => {} },
      ),
    ).rejects.toThrow("nope");
    expect(calls).toBe(1);
  });
});

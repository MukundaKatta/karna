// ─── Tool Rate Limiter Tests (Issue #552) ────────────────────────────────────

import { describe, it, expect } from "vitest";
import { ToolRateLimiter, RateLimitTimeoutError } from "../../agent/src/tools/rate-limiter.js";

describe("ToolRateLimiter", () => {
  it("returns a no-op lease for unconfigured tools (no behavior change)", async () => {
    const limiter = new ToolRateLimiter();
    expect(limiter.isLimited("free")).toBe(false);
    const lease = await limiter.acquire("free");
    expect(typeof lease.release).toBe("function");
    lease.release(); // should not throw
  });

  it("enforces max concurrency", async () => {
    const limiter = new ToolRateLimiter({ t: { maxConcurrent: 2 } });
    const a = await limiter.acquire("t");
    const b = await limiter.acquire("t");
    expect(limiter.stats("t").active).toBe(2);

    let cAcquired = false;
    const cPromise = limiter.acquire("t").then((lease) => {
      cAcquired = true;
      return lease;
    });

    // c should be blocked until one of a/b releases.
    await new Promise((r) => setTimeout(r, 30));
    expect(cAcquired).toBe(false);

    a.release();
    const c = await cPromise;
    expect(cAcquired).toBe(true);
    b.release();
    c.release();
    expect(limiter.stats("t").active).toBe(0);
  });

  it("rate-limits via token bucket using a controllable clock", async () => {
    let now = 0;
    const limiter = new ToolRateLimiter(
      { t: { ratePerSec: 1, burst: 1, maxWaitMs: 0 } },
      { now: () => now }
    );

    // First token available from initial burst.
    const l1 = await limiter.acquire("t");
    l1.release();
    expect(limiter.stats("t").tokens).toBeLessThan(1);

    // Advance clock by 1s -> one token refilled.
    now = 1000;
    const l2 = await limiter.acquire("t");
    l2.release();
    expect(limiter.stats("t").active).toBe(0);
  });

  it("times out when maxWaitMs is exceeded under contention", async () => {
    const limiter = new ToolRateLimiter({ t: { maxConcurrent: 1, maxWaitMs: 20 } });
    const held = await limiter.acquire("t");
    await expect(limiter.acquire("t")).rejects.toBeInstanceOf(RateLimitTimeoutError);
    held.release();
  });

  it("aborts a pending acquire when the signal fires", async () => {
    const limiter = new ToolRateLimiter({ t: { maxConcurrent: 1 } });
    const held = await limiter.acquire("t");
    const controller = new AbortController();
    const pending = limiter.acquire("t", controller.signal);
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toBeInstanceOf(RateLimitTimeoutError);
    held.release();
  });
});

import { describe, it, expect } from "vitest";
import { UsageMeter, InMemoryUsageStore } from "../../packages/payments/src/usage.js";

describe("UsageMeter session limits", () => {
  it("tracks per-session message counts separately from monthly usage", async () => {
    const meter = new UsageMeter(new InMemoryUsageStore());

    await meter.trackSessionMessage("agent-1", "session-a", "web");
    await meter.trackSessionMessage("agent-1", "session-a", "web");
    await meter.trackSessionMessage("agent-1", "session-b", "web");

    const usage = await meter.getSessionUsage("agent-1", "session-a");
    expect(usage.totalMessages).toBe(2);
  });

  it("enforces configurable per-session message limits", async () => {
    const meter = new UsageMeter(new InMemoryUsageStore());
    await meter.trackSessionMessage("agent-1", "session-a", "web");
    await meter.trackSessionMessage("agent-1", "session-a", "web");

    const result = await meter.checkSessionLimits("agent-1", "session-a", 2);
    expect(result.allowed).toBe(false);
    expect(result.used).toBe(2);
    expect(result.remaining).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import { InlineApprovalCorrelator } from "../../agent/src/approval/inline-approval.js";

function seqTokens() {
  let n = 0;
  return () => `tok-${++n}`;
}

describe("Inline Approval Correlation (#588)", () => {
  it("mints an opaque token for a pending action", () => {
    const c = new InlineApprovalCorrelator({ now: () => 1000, generateToken: seqTokens() });
    const action = c.register({ toolCallId: "call-1", channel: "telegram", payload: { msg: 7 } });
    expect(action.token).toBe("tok-1");
    expect(action.toolCallId).toBe("call-1");
    expect(action.channel).toBe("telegram");
    expect(action.expiresAt).toBeGreaterThan(action.createdAt);
    expect(c.size).toBe(1);
  });

  it("resolves an inbound decision back to the action and consumes it", () => {
    const c = new InlineApprovalCorrelator({ now: () => 1000, generateToken: seqTokens() });
    c.register({ toolCallId: "call-1", channel: "slack", payload: { ts: "x" } });
    const outcome = c.resolve("tok-1", "approve");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.decision).toBe("approve");
      expect(outcome.action.toolCallId).toBe("call-1");
      expect((outcome.action.payload as { ts: string }).ts).toBe("x");
    }
    // single-use: gone after resolve
    expect(c.size).toBe(0);
  });

  it("rejects an unknown token", () => {
    const c = new InlineApprovalCorrelator();
    const outcome = c.resolve("nope", "deny");
    expect(outcome).toEqual({ ok: false, reason: "unknown-token" });
  });

  it("reports already-resolved on second resolve", () => {
    const c = new InlineApprovalCorrelator({ generateToken: seqTokens() });
    c.register({ toolCallId: "call-1", channel: "discord" });
    c.resolve("tok-1", "approve");
    const second = c.resolve("tok-1", "approve");
    // consumed -> looks like an unknown token
    expect(second.ok).toBe(false);
  });

  it("expires tokens past their TTL", () => {
    let t = 0;
    const c = new InlineApprovalCorrelator({
      now: () => t,
      defaultTtlMs: 100,
      generateToken: seqTokens(),
    });
    c.register({ toolCallId: "call-1", channel: "sms" });
    t = 101;
    const outcome = c.resolve("tok-1", "approve");
    expect(outcome).toEqual({ ok: false, reason: "expired" });
    expect(c.size).toBe(0);
  });

  it("peek returns the action while valid and undefined once expired", () => {
    let t = 0;
    const c = new InlineApprovalCorrelator({
      now: () => t,
      defaultTtlMs: 50,
      generateToken: seqTokens(),
    });
    c.register({ toolCallId: "call-1", channel: "webchat" });
    expect(c.peek("tok-1")?.toolCallId).toBe("call-1");
    t = 60;
    expect(c.peek("tok-1")).toBeUndefined();
  });

  it("respects a per-action ttlMs override", () => {
    let t = 0;
    const c = new InlineApprovalCorrelator({ now: () => t, defaultTtlMs: 1000, generateToken: seqTokens() });
    c.register({ toolCallId: "call-1", channel: "irc", ttlMs: 10 });
    t = 20;
    expect(c.resolve("tok-1", "approve").ok).toBe(false);
  });

  it("cancels a pending action by tool call id", () => {
    const c = new InlineApprovalCorrelator({ generateToken: seqTokens() });
    c.register({ toolCallId: "call-1", channel: "matrix" });
    expect(c.cancelByToolCall("call-1")).toBe(true);
    expect(c.size).toBe(0);
    expect(c.cancelByToolCall("call-1")).toBe(false);
  });

  it("sweeps expired tokens", () => {
    let t = 0;
    const c = new InlineApprovalCorrelator({ now: () => t, defaultTtlMs: 100, generateToken: seqTokens() });
    c.register({ toolCallId: "a", channel: "line" });
    c.register({ toolCallId: "b", channel: "line", ttlMs: 1000 });
    t = 200;
    expect(c.sweepExpired()).toBe(1);
    expect(c.size).toBe(1);
    expect(c.peek("tok-2")?.toolCallId).toBe("b");
  });

  it("generates unique tokens by default (no token override)", () => {
    const c = new InlineApprovalCorrelator();
    const a = c.register({ toolCallId: "1", channel: "x" });
    const b = c.register({ toolCallId: "2", channel: "x" });
    expect(a.token).not.toBe(b.token);
  });
});

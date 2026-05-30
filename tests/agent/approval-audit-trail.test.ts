import { describe, it, expect } from "vitest";
import { ApprovalAuditTrail } from "../../agent/src/approval/audit-trail.js";

describe("Approval Audit Trail (#591)", () => {
  it("records entries with auto-timestamp from the clock", () => {
    const trail = new ApprovalAuditTrail({ now: () => 555 });
    const entry = trail.record({ toolCallId: "c1", decision: "approve", actor: "alice" });
    expect(entry.timestamp).toBe(555);
    expect(trail.size).toBe(1);
  });

  it("honors an explicit timestamp", () => {
    const trail = new ApprovalAuditTrail();
    const entry = trail.record({
      toolCallId: "c1",
      decision: "deny",
      actor: "bob",
      timestamp: 999,
    });
    expect(entry.timestamp).toBe(999);
  });

  it("is append-only and preserves order", () => {
    const trail = new ApprovalAuditTrail({ now: (() => { let t = 0; return () => ++t; })() });
    trail.record({ toolCallId: "c1", decision: "approve", actor: "a" });
    trail.record({ toolCallId: "c1", decision: "edit", actor: "b" });
    trail.record({ toolCallId: "c2", decision: "deny", actor: "a" });
    const all = trail.all();
    expect(all.map((e) => e.decision)).toEqual(["approve", "edit", "deny"]);
  });

  it("returned entries are frozen", () => {
    const trail = new ApprovalAuditTrail();
    const entry = trail.record({ toolCallId: "c1", decision: "approve", actor: "a" });
    expect(Object.isFrozen(entry)).toBe(true);
  });

  it("validates input and rejects empty fields", () => {
    const trail = new ApprovalAuditTrail();
    expect(() => trail.record({ toolCallId: "", decision: "approve", actor: "a" })).toThrow();
    // @ts-expect-error invalid decision
    expect(() => trail.record({ toolCallId: "c", decision: "nope", actor: "a" })).toThrow();
  });

  describe("query", () => {
    function seed() {
      const trail = new ApprovalAuditTrail();
      trail.record({ toolCallId: "c1", decision: "approve", actor: "alice", timestamp: 10 });
      trail.record({ toolCallId: "c1", decision: "edit", actor: "bob", timestamp: 20 });
      trail.record({ toolCallId: "c2", decision: "deny", actor: "alice", timestamp: 30 });
      return trail;
    }

    it("filters by toolCallId", () => {
      expect(seed().query({ toolCallId: "c1" })).toHaveLength(2);
    });

    it("filters by actor", () => {
      expect(seed().query({ actor: "alice" })).toHaveLength(2);
    });

    it("filters by decision", () => {
      expect(seed().query({ decision: "edit" })).toHaveLength(1);
    });

    it("filters by time range (inclusive)", () => {
      expect(seed().query({ since: 20, until: 30 })).toHaveLength(2);
    });

    it("ANDs filters together", () => {
      expect(seed().query({ toolCallId: "c1", actor: "bob" })).toHaveLength(1);
    });

    it("forToolCall is a shorthand", () => {
      expect(seed().forToolCall("c2")).toHaveLength(1);
    });
  });

  describe("export", () => {
    it("exports a plain JSON-serializable array", () => {
      const trail = new ApprovalAuditTrail();
      trail.record({ toolCallId: "c1", decision: "approve", actor: "a", timestamp: 1 });
      const exported = trail.export();
      expect(Object.isFrozen(exported[0])).toBe(false);
      expect(JSON.parse(JSON.stringify(exported))).toEqual(exported);
    });

    it("exports JSONL with one entry per line", () => {
      const trail = new ApprovalAuditTrail();
      trail.record({ toolCallId: "c1", decision: "approve", actor: "a", timestamp: 1 });
      trail.record({ toolCallId: "c2", decision: "deny", actor: "b", timestamp: 2 });
      const lines = trail.exportJsonl().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).toolCallId).toBe("c1");
    });
  });

  it("respects the maxEntries ring buffer", () => {
    const trail = new ApprovalAuditTrail({ maxEntries: 2 });
    trail.record({ toolCallId: "c1", decision: "approve", actor: "a", timestamp: 1 });
    trail.record({ toolCallId: "c2", decision: "approve", actor: "a", timestamp: 2 });
    trail.record({ toolCallId: "c3", decision: "approve", actor: "a", timestamp: 3 });
    expect(trail.size).toBe(2);
    expect(trail.all().map((e) => e.toolCallId)).toEqual(["c2", "c3"]);
  });
});

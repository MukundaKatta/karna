import { describe, it, expect, beforeEach } from "vitest";
import {
  HashChain,
  HashChainAuditBackend,
  verifyChain,
  computeRecordHash,
  canonicalize,
  GENESIS_HASH,
  type ChainedAuditRecord,
} from "../../gateway/src/audit/hash-chain.js";
import { AuditLogger, LogAuditBackend, type AuditEvent } from "../../gateway/src/audit/logger.js";

let seq = 0;
function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  seq++;
  return {
    id: `audit_${seq}`,
    timestamp: 1_700_000_000_000 + seq,
    eventType: "auth.login",
    actorId: `user-${seq}`,
    action: "login",
    success: true,
    ...overrides,
  };
}

describe("canonicalize", () => {
  it("produces key-order-independent output", () => {
    const a = canonicalize({ b: 1, a: 2, nested: { y: 1, x: 2 } });
    const b = canonicalize({ a: 2, nested: { x: 2, y: 1 }, b: 1 });
    expect(a).toBe(b);
  });

  it("preserves array order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("computeRecordHash", () => {
  it("is deterministic", () => {
    const e = makeEvent();
    expect(computeRecordHash(e, GENESIS_HASH, 0)).toBe(computeRecordHash(e, GENESIS_HASH, 0));
  });

  it("changes when the event changes", () => {
    const e1 = makeEvent({ id: "x", actorId: "alice" });
    const e2 = { ...e1, actorId: "mallory" };
    expect(computeRecordHash(e1, GENESIS_HASH, 0)).not.toBe(
      computeRecordHash(e2, GENESIS_HASH, 0),
    );
  });

  it("changes when prevHash changes", () => {
    const e = makeEvent();
    expect(computeRecordHash(e, GENESIS_HASH, 0)).not.toBe(
      computeRecordHash(e, "a".repeat(64), 0),
    );
  });

  it("changes when sequence changes", () => {
    const e = makeEvent();
    expect(computeRecordHash(e, GENESIS_HASH, 0)).not.toBe(
      computeRecordHash(e, GENESIS_HASH, 1),
    );
  });

  it("produces a 64-char hex sha-256 digest", () => {
    expect(computeRecordHash(makeEvent(), GENESIS_HASH, 0)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("HashChain", () => {
  let chain: HashChain;

  beforeEach(() => {
    chain = new HashChain();
  });

  it("starts empty with genesis head hash", () => {
    expect(chain.length).toBe(0);
    expect(chain.headHash).toBe(GENESIS_HASH);
  });

  it("links the first record to GENESIS_HASH", () => {
    const rec = chain.append(makeEvent());
    expect(rec.sequence).toBe(0);
    expect(rec.prevHash).toBe(GENESIS_HASH);
    expect(rec.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(chain.headHash).toBe(rec.hash);
  });

  it("links each record to its predecessor", () => {
    const r0 = chain.append(makeEvent());
    const r1 = chain.append(makeEvent());
    const r2 = chain.append(makeEvent());
    expect(r1.prevHash).toBe(r0.hash);
    expect(r2.prevHash).toBe(r1.hash);
    expect(r1.sequence).toBe(1);
    expect(r2.sequence).toBe(2);
  });

  it("verifies a well-formed chain", () => {
    for (let i = 0; i < 10; i++) chain.append(makeEvent());
    const result = chain.verify();
    expect(result.valid).toBe(true);
    expect(result.length).toBe(10);
    expect(result.brokenAt).toBeUndefined();
  });

  it("returns defensive copies of records", () => {
    chain.append(makeEvent({ actorId: "alice" }));
    const records = chain.getRecords();
    records[0]!.event.actorId = "tampered";
    // Internal chain should still verify against the original.
    expect(chain.verify().valid).toBe(true);
  });
});

describe("verifyChain — tamper detection", () => {
  function buildChain(n: number): ChainedAuditRecord[] {
    const chain = new HashChain();
    for (let i = 0; i < n; i++) chain.append(makeEvent());
    return chain.getRecords();
  }

  it("detects a mutated event payload", () => {
    const records = buildChain(5);
    records[2]!.event.actorId = "mallory"; // tamper, but hash unchanged
    const result = verifyChain(records);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
    expect(result.reason).toMatch(/hash mismatch/);
  });

  it("detects a deleted record (sequence gap)", () => {
    const records = buildChain(5);
    records.splice(2, 1); // remove record at sequence 2
    const result = verifyChain(records);
    expect(result.valid).toBe(false);
    // Index 2 now holds the record with sequence 3.
    expect(result.brokenAt).toBe(2);
    expect(result.reason).toMatch(/sequence mismatch/);
  });

  it("detects reordered records", () => {
    const records = buildChain(4);
    const tmp = records[1]!;
    records[1] = records[2]!;
    records[2] = tmp;
    const result = verifyChain(records);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it("detects a broken prevHash link", () => {
    const records = buildChain(3);
    records[1]!.prevHash = "f".repeat(64);
    const result = verifyChain(records);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.reason).toMatch(/prevHash mismatch/);
  });

  it("detects an inserted record", () => {
    const records = buildChain(3);
    const chain = new HashChain();
    const forged = chain.append(makeEvent({ id: "forged" }));
    records.splice(1, 0, { ...forged, sequence: 1 });
    const result = verifyChain(records);
    expect(result.valid).toBe(false);
  });

  it("treats an empty chain as valid", () => {
    expect(verifyChain([]).valid).toBe(true);
  });
});

describe("HashChainAuditBackend (composition with AuditLogger)", () => {
  it("chains events written through AuditLogger without changing its API", async () => {
    const backend = new HashChainAuditBackend();
    const auditLogger = new AuditLogger([backend]);

    await auditLogger.logAuth("auth.login", "user-1", true);
    await auditLogger.logSession("session.created", "session-1", "user-1");
    await auditLogger.logToolExec("tool.executed", "web_search", "session-1", true);

    expect(backend.length).toBe(3);
    expect(backend.verify().valid).toBe(true);
    expect(backend.headHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("delegates writes and queries to an inner backend", async () => {
    const inner = new LogAuditBackend();
    const backend = new HashChainAuditBackend(inner);
    const auditLogger = new AuditLogger([backend]);

    await auditLogger.logAuth("auth.login", "user-1", true);
    // Query is delegated to the inner backend.
    const events = await auditLogger.query({ eventType: "auth.login" });
    expect(events).toHaveLength(1);
    expect(events[0]!.actorId).toBe("user-1");
    // Chain still recorded.
    expect(backend.length).toBe(1);
    expect(backend.verify().valid).toBe(true);
  });

  it("queries its own chain records when no inner backend is set", async () => {
    const backend = new HashChainAuditBackend();
    const auditLogger = new AuditLogger([backend]);
    await auditLogger.logAuth("auth.login", "alice", true);
    await auditLogger.logAuth("auth.login", "bob", true);

    const all = await backend.query({});
    expect(all).toHaveLength(2);
    const filtered = await backend.query({ actorId: "alice" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.actorId).toBe("alice");
  });

  it("flags tampering of an exported chain snapshot", async () => {
    const backend = new HashChainAuditBackend();
    const auditLogger = new AuditLogger([backend]);
    await auditLogger.logAuth("auth.login", "user-1", true);
    await auditLogger.logConfigChange("admin", "agent-config", { field: "model" });

    const snapshot = backend.getRecords();
    snapshot[1]!.event.metadata = { field: "DELETED_EVIDENCE" };
    const result = verifyChain(snapshot);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });
});

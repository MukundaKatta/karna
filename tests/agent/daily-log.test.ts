import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DailyLogManager } from "../../agent/src/memory/daily-log.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("DailyLogManager", () => {
  let manager: DailyLogManager;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "karna-dailylog-test-"));
    manager = new DailyLogManager(tempDir);
  });

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true }); } catch {}
  });

  it("creates daily log on first append", () => {
    manager.logConversation("User asked about weather");
    const today = manager.readToday();
    expect(today).not.toBeNull();
    expect(today).toContain("Daily Log");
    expect(today).toContain("conversation");
    expect(today).toContain("User asked about weather");
  });

  it("appends multiple entries", () => {
    manager.logConversation("First message");
    manager.logObservation("User likes TypeScript", ["preference"]);
    manager.logDecision("Using Claude for code tasks", ["model"]);
    const today = manager.readToday();
    expect(today).toContain("First message");
    expect(today).toContain("User likes TypeScript");
    expect(today).toContain("Using Claude for code tasks");
  });

  it("includes tags in entries", () => {
    manager.logObservation("Important fact", ["important", "fact"]);
    const today = manager.readToday();
    expect(today).toContain("[important, fact]");
  });

  it("includes session ID", () => {
    manager.logConversation("Message", "abc12345xyz");
    const today = manager.readToday();
    expect(today).toContain("session: abc12345");
  });

  it("returns null for dates with no logs", () => {
    expect(manager.readDate("2020-01-01")).toBeNull();
  });

  it("reads recent logs", () => {
    manager.logConversation("Today's message");
    const recent = manager.readRecent(7);
    expect(recent.length).toBeGreaterThanOrEqual(1);
    expect(recent[0]!.content).toContain("Today's message");
  });

  it("generates context for system prompt", () => {
    manager.logConversation("Important context");
    const context = manager.getRecentContext(3);
    expect(context).toContain("Recent Activity Log");
    expect(context).toContain("Important context");
  });

  it("returns empty context when no logs", () => {
    const fresh = new DailyLogManager(mkdtempSync(join(tmpdir(), "karna-empty-")));
    expect(fresh.getRecentContext()).toBe("");
  });
});

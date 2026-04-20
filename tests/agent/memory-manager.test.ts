import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryManager } from "../../agent/src/memory/manager.js";
import { MemoryStore, InMemoryBackend } from "../../agent/src/memory/store.js";

describe("MemoryManager (3-tier)", () => {
  let manager: MemoryManager;
  let longTermStore: MemoryStore;

  beforeEach(() => {
    longTermStore = new MemoryStore(new InMemoryBackend());
    manager = new MemoryManager(longTermStore, {
      workingMemoryMaxTokens: 10_000,
      promotionThreshold: 0.7,
    });
  });

  afterEach(() => {
    manager.stop();
  });

  describe("working memory", () => {
    it("creates working memory per session", () => {
      const wm1 = manager.getWorkingMemory("session-1");
      const wm2 = manager.getWorkingMemory("session-2");
      expect(wm1).not.toBe(wm2);
    });

    it("returns same instance for same session", () => {
      const wm1 = manager.getWorkingMemory("session-1");
      const wm2 = manager.getWorkingMemory("session-1");
      expect(wm1).toBe(wm2);
    });

    it("adds messages to working memory", () => {
      manager.addMessage("session-1", {
        role: "user",
        content: "Hello",
        timestamp: Date.now(),
      });
      const wm = manager.getWorkingMemory("session-1");
      expect(wm.messageCount).toBe(1);
    });
  });

  describe("short-term memory", () => {
    it("stores observations", () => {
      const entry = manager.storeObservation(
        "session-1",
        "User prefers concise responses",
        "observation",
        0.8,
        ["preference"],
      );
      expect(entry.id).toBeTruthy();
      expect(entry.content).toBe("User prefers concise responses");
      expect(entry.importance).toBe(0.8);
    });

    it("stores tool results", () => {
      const entry = manager.storeToolResult(
        "session-1",
        "web_search",
        "Found 5 articles about AI",
      );
      expect(entry.category).toBe("tool_result");
      expect(entry.tags).toContain("web_search");
    });
  });

  describe("long-term memory", () => {
    it("saves to long-term store", async () => {
      const entry = await manager.saveLongTerm({
        agentId: "agent-1",
        content: "Important fact",
        source: "conversation",
        tags: ["fact"],
      });
      expect(entry).not.toBeNull();
      expect(entry?.content).toBe("Important fact");
    });

    it("returns null when no long-term store", async () => {
      const noLtm = new MemoryManager(null);
      const entry = await noLtm.saveLongTerm({
        agentId: "agent-1",
        content: "test",
        source: "conversation",
      });
      expect(entry).toBeNull();
      noLtm.stop();
    });
  });

  describe("unified context", () => {
    it("combines all tiers", async () => {
      manager.addMessage("session-1", {
        role: "user",
        content: "Tell me about AI",
        timestamp: Date.now(),
      });
      manager.storeObservation("session-1", "User interested in AI", "observation", 0.8);

      const ctx = await manager.getContext("session-1");
      expect(ctx.workingMessages).toHaveLength(1);
      expect(ctx.shortTermContext).toContain("User interested in AI");
      expect(ctx.longTermMemories).toEqual([]);
    });
  });

  describe("session cleanup", () => {
    it("clears working and short-term memory on session end", async () => {
      manager.addMessage("session-1", { role: "user", content: "hi", timestamp: Date.now() });
      manager.storeObservation("session-1", "test", "observation", 0.3);

      await manager.endSession("session-1");

      const wm = manager.getWorkingMemory("session-1");
      expect(wm.messageCount).toBe(0); // New working memory created
    });
  });

  describe("promotion", () => {
    it("promotes high-importance entries to long-term", async () => {
      manager.storeObservation("session-1", "Important fact", "fact", 0.9, ["important"]);
      manager.storeObservation("session-1", "Trivial detail", "observation", 0.3);

      const promoted = await manager.promoteToLongTerm("session-1", "agent-1");
      expect(promoted).toBe(1); // Only the 0.9 importance one
    });
  });

  describe("long-term maintenance", () => {
    it("enforces max long-term memories per agent", async () => {
      const retentionStore = new MemoryStore(new InMemoryBackend());
      const retentionManager = new MemoryManager(retentionStore, {
        maxLongTermMemoriesPerAgent: 2,
      });

      await retentionManager.saveLongTerm({
        agentId: "agent-1",
        content: "Memory 1",
        source: "conversation",
      });
      await retentionManager.saveLongTerm({
        agentId: "agent-1",
        content: "Memory 2",
        source: "conversation",
      });
      await retentionManager.saveLongTerm({
        agentId: "agent-1",
        content: "Memory 3",
        source: "conversation",
      });

      const deleted = await retentionManager.enforceRetention("agent-1");
      const remaining = await retentionStore.listByAgent("agent-1");

      expect(deleted).toBe(1);
      expect(remaining).toHaveLength(2);
      retentionManager.stop();
    });

    it("consolidates related long-term memories into a summary memory", async () => {
      await manager.saveLongTerm({
        agentId: "agent-1",
        content: "User prefers concise answers",
        source: "conversation",
        sessionId: "session-1",
        category: "preference",
        tags: ["preference"],
      });
      await manager.saveLongTerm({
        agentId: "agent-1",
        content: "User likes bullet lists",
        source: "conversation",
        sessionId: "session-1",
        category: "preference",
        tags: ["formatting"],
      });

      const consolidated = await manager.consolidateLongTerm("agent-1");
      const remaining = await longTermStore.listByAgent("agent-1");

      expect(consolidated).toBe(1);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.tags).toContain("consolidated");
      expect(remaining[0]?.content).toContain("Consolidated memory");
    });
  });
});

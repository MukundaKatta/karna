import { describe, expect, it } from "vitest";
import {
  RecordedIO,
  conversationMessageToEvent,
  parseReplayRecord,
  replayFromJsonl,
  replayRun,
  type ReplayEvent,
} from "../../agent/src/checkpoint/index.js";
import type { ConversationMessage } from "@karna/shared/types/session.js";

describe("parseReplayRecord", () => {
  it("parses explicit replay events", () => {
    const jsonl = [
      JSON.stringify({ kind: "user", content: "hi" }),
      JSON.stringify({ kind: "model", text: "hello", toolUses: [], usage: { inputTokens: 5, outputTokens: 2 } }),
    ].join("\n");
    const events = parseReplayRecord(jsonl);
    expect(events).toHaveLength(2);
    expect(events[0]?.kind).toBe("user");
    expect(events[1]?.kind).toBe("model");
  });

  it("parses plain ConversationMessage transcript lines", () => {
    const lines: ConversationMessage[] = [
      { id: "1", sessionId: "s", role: "user", content: "ping", timestamp: 1 },
      {
        id: "2",
        sessionId: "s",
        role: "tool",
        content: "{\"ok\":true}",
        timestamp: 2,
        metadata: { toolCallId: "c1", toolName: "ping_tool" },
      },
      { id: "3", sessionId: "s", role: "assistant", content: "pong", timestamp: 3 },
    ];
    const jsonl = lines.map((l) => JSON.stringify(l)).join("\n");
    const events = parseReplayRecord(jsonl);
    expect(events.map((e) => e.kind)).toEqual(["user", "tool_result", "model"]);
    const tool = events[1];
    expect(tool?.kind === "tool_result" && tool.id).toBe("c1");
    expect(tool?.kind === "tool_result" && tool.output).toEqual({ ok: true });
  });

  it("skips malformed and system lines", () => {
    const sysMsg: ConversationMessage = { id: "s1", sessionId: "s", role: "system", content: "prompt", timestamp: 1 };
    const jsonl = [
      "{ broken",
      JSON.stringify(sysMsg),
      JSON.stringify({ kind: "user", content: "hi" }),
      JSON.stringify({ kind: "model" }), // invalid: missing required text
    ].join("\n");
    const events = parseReplayRecord(jsonl);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("user");
  });
});

describe("conversationMessageToEvent", () => {
  it("keeps raw string output when tool content is not JSON", () => {
    const msg: ConversationMessage = {
      id: "1",
      sessionId: "s",
      role: "tool",
      content: "plain text",
      timestamp: 1,
      metadata: { toolCallId: "c1", toolName: "t" },
    };
    const event = conversationMessageToEvent(msg);
    expect(event?.kind === "tool_result" && event.output).toBe("plain text");
  });

  it("returns null for system messages", () => {
    const msg: ConversationMessage = { id: "1", sessionId: "s", role: "system", content: "x", timestamp: 1 };
    expect(conversationMessageToEvent(msg)).toBeNull();
  });
});

describe("RecordedIO", () => {
  it("walks model steps deterministically and resolves tools by id", () => {
    const events: ReplayEvent[] = [
      { kind: "model", text: "a", toolUses: [{ id: "t1", name: "x", input: {} }], usage: { inputTokens: 0, outputTokens: 0 } },
      { kind: "tool_result", id: "t1", name: "x", output: 42, isError: false },
      { kind: "model", text: "b", toolUses: [], usage: { inputTokens: 0, outputTokens: 0 } },
    ];
    const io = new RecordedIO(events);
    expect(io.modelStepCount).toBe(2);
    expect(io.nextModelStep()?.text).toBe("a");
    expect(io.resolveTool("t1")?.output).toBe(42);
    expect(io.nextModelStep()?.text).toBe("b");
    expect(io.nextModelStep()).toBeNull();
    expect(io.exhausted).toBe(true);
  });

  it("falls back to queue order when tool id is unknown", () => {
    const events: ReplayEvent[] = [
      { kind: "tool_result", id: "unknown", name: "x", output: "first", isError: false },
    ];
    const io = new RecordedIO(events);
    expect(io.resolveTool("some-id")?.output).toBe("first");
    expect(io.resolveTool("some-id")).toBeNull();
  });
});

describe("replayRun", () => {
  it("replays a tool-using run to a final response deterministically", () => {
    const events: ReplayEvent[] = [
      { kind: "user", content: "search and summarize" },
      {
        kind: "model",
        text: "Let me search.",
        toolUses: [{ id: "t1", name: "search", input: { q: "x" } }],
        usage: { inputTokens: 100, outputTokens: 10 },
      },
      { kind: "tool_result", id: "t1", name: "search", output: { hits: 2 }, isError: false },
      {
        kind: "model",
        text: "Found 2 results.",
        toolUses: [],
        usage: { inputTokens: 50, outputTokens: 5 },
      },
    ];

    const first = replayRun(events);
    const second = replayRun(events);
    expect(first).toEqual(second); // deterministic

    expect(first.userMessage).toBe("search and summarize");
    expect(first.response).toBe("Found 2 results.");
    expect(first.completed).toBe(true);
    expect(first.iterations).toBe(2);
    expect(first.usage).toEqual({ inputTokens: 150, outputTokens: 15 });
    expect(first.toolCalls).toHaveLength(1);
    expect(first.toolCalls[0]?.output).toEqual({ hits: 2 });
    expect(first.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
  });

  it("records an error tool call when no result is in the record", () => {
    const events: ReplayEvent[] = [
      { kind: "user", content: "go" },
      {
        kind: "model",
        text: "",
        toolUses: [{ id: "missing", name: "search", input: {} }],
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    ];
    const result = replayRun(events);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.isError).toBe(true);
    expect(result.completed).toBe(false);
  });

  it("honors the maxIterations budget", () => {
    const events: ReplayEvent[] = [];
    for (let i = 0; i < 5; i++) {
      events.push({
        kind: "model",
        text: `step ${i}`,
        toolUses: [{ id: `t${i}`, name: "loop", input: {} }],
        usage: { inputTokens: 0, outputTokens: 0 },
      });
      events.push({ kind: "tool_result", id: `t${i}`, name: "loop", output: i, isError: false });
    }
    const result = replayRun(events, { maxIterations: 2 });
    expect(result.iterations).toBe(2);
    expect(result.completed).toBe(false);
  });

  it("replays a plain JSONL transcript end-to-end", () => {
    const transcript: ConversationMessage[] = [
      { id: "1", sessionId: "s", role: "system", content: "You are Karna.", timestamp: 1 },
      { id: "2", sessionId: "s", role: "user", content: "hello", timestamp: 2 },
      {
        id: "3",
        sessionId: "s",
        role: "assistant",
        content: "Hi there!",
        timestamp: 3,
        metadata: { inputTokens: 12, outputTokens: 4 },
      },
    ];
    const jsonl = transcript.map((m) => JSON.stringify(m)).join("\n");
    const result = replayFromJsonl(jsonl);
    expect(result.userMessage).toBe("hello");
    expect(result.response).toBe("Hi there!");
    expect(result.completed).toBe(true);
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 4 });
  });
});

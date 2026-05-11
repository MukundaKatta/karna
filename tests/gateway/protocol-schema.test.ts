import { describe, expect, it } from "vitest";
import { parseMessageDetailed } from "../../gateway/src/protocol/schema.js";

describe("protocol schema parsing", () => {
  it("returns field-level details for invalid protocol messages", () => {
    const result = parseMessageDetailed(JSON.stringify({
      id: "bad",
      type: "chat.message",
      timestamp: Date.now(),
      payload: {},
    }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Message failed protocol schema validation.");
      expect(result.fieldErrors).toHaveProperty("payload");
      expect(result.rawType).toBe("chat.message");
    }
  });

  it("returns a validated message for valid protocol payloads", () => {
    const result = parseMessageDetailed(JSON.stringify({
      id: "ok",
      type: "heartbeat.ack",
      timestamp: Date.now(),
      payload: { clientTime: Date.now() },
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe("heartbeat.ack");
    }
  });

  it.each([
    ["memory.list", { query: "shipping", category: "task", limit: 25 }],
    ["memory.search", { query: "shipping", category: "task" }],
    ["reminder.list", {}],
    ["skill.list", {}],
  ])("accepts mobile refresh message %s", (type, payload) => {
    const result = parseMessageDetailed(JSON.stringify({
      id: `refresh-${type}`,
      type,
      timestamp: Date.now(),
      sessionId: "mobile-session-1",
      payload,
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe(type);
    }
  });
});

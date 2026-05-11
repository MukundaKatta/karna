import { afterEach, describe, expect, it } from "vitest";
import { buildContext } from "../../agent/src/context/builder.js";
import type { ConversationMessage, Session } from "../../packages/shared/src/types/session.js";
import type { AgentPersona } from "../../agent/src/context/system-prompt.js";

const originalMaxContextMessages = process.env["MAX_CONTEXT_MESSAGES"];
const originalKarnaMaxContextMessages = process.env["KARNA_MAX_CONTEXT_MESSAGES"];

afterEach(() => {
  restoreEnv("MAX_CONTEXT_MESSAGES", originalMaxContextMessages);
  restoreEnv("KARNA_MAX_CONTEXT_MESSAGES", originalKarnaMaxContextMessages);
});

describe("context builder history compaction", () => {
  it("keeps the last 20 messages by default and summarizes older messages", () => {
    const context = buildContext({
      session: makeSession(),
      agent: makeAgent(),
      conversationHistory: makeHistory(55),
    });

    expect(context.wasTruncated).toBe(true);
    expect(context.droppedMessageCount).toBe(35);
    expect(context.messages).toHaveLength(21);
    expect(context.messages[0]?.role).toBe("system");
    expect(context.messages[0]?.content).toContain("35 older messages summarized");
    expect(context.messages[1]?.content).toBe("message 36");
    expect(context.messages.at(-1)?.content).toBe("message 55");
  });

  it("honors maxContextMessages config alias", () => {
    const context = buildContext(
      {
        session: makeSession(),
        agent: makeAgent(),
        conversationHistory: makeHistory(8),
      },
      { maxContextMessages: 3 },
    );

    expect(context.messages).toHaveLength(4);
    expect(context.droppedMessageCount).toBe(5);
    expect(context.messages[1]?.content).toBe("message 6");
  });

  it("honors MAX_CONTEXT_MESSAGES environment config", () => {
    process.env["MAX_CONTEXT_MESSAGES"] = "4";

    const context = buildContext({
      session: makeSession(),
      agent: makeAgent(),
      conversationHistory: makeHistory(7),
    });

    expect(context.messages).toHaveLength(5);
    expect(context.droppedMessageCount).toBe(3);
    expect(context.messages[1]?.content).toBe("message 4");
  });

  it("preserves recent tool result messages inside the sliding window", () => {
    const history = makeHistory(25);
    history[23] = {
      id: "tool-result",
      role: "tool",
      content: "weather result",
      timestamp: Date.now(),
      metadata: { toolName: "weather", toolCallId: "call-1" },
    };

    const context = buildContext({
      session: makeSession(),
      agent: makeAgent(),
      conversationHistory: history,
    });

    expect(context.messages.some((message) => message.role === "tool" && message.content === "weather result")).toBe(
      true,
    );
  });
});

function makeHistory(count: number): ConversationMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `msg-${index + 1}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message ${index + 1}`,
    timestamp: Date.now() + index,
  }));
}

function makeSession(): Session {
  return {
    id: "session-1",
    channelType: "web",
    channelId: "web-1",
    userId: "user-1",
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeAgent(): AgentPersona {
  return {
    id: "agent-1",
    name: "Karna",
    role: "assistant",
    personality: "helpful",
  };
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

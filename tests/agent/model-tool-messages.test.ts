import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "../../agent/src/models/anthropic.js";
import { OpenAIProvider } from "../../agent/src/models/openai.js";
import type { ChatParams } from "../../agent/src/models/provider.js";

function buildOpenAIMessages(
  provider: OpenAIProvider,
  params: ChatParams,
): unknown[] {
  return (
    provider as unknown as {
      buildMessages(params: ChatParams): unknown[];
    }
  ).buildMessages(params);
}

function buildAnthropicMessages(
  provider: AnthropicProvider,
  params: ChatParams,
): unknown[] {
  return (
    provider as unknown as {
      buildMessages(params: ChatParams): unknown[];
    }
  ).buildMessages(params);
}

const toolConversation: ChatParams = {
  messages: [
    { role: "user", content: "List the current directory." },
    {
      role: "assistant",
      content: "",
      toolUses: [
        {
          id: "call_shell_1",
          name: "shell_exec",
          input: { command: "ls -F" },
        },
      ],
    },
    {
      role: "tool",
      content: JSON.stringify({ error: "Tool call was rejected by the user" }),
      toolCallId: "call_shell_1",
      toolName: "shell_exec",
    },
  ],
};

describe("provider tool message serialization", () => {
  it("keeps assistant tool_calls before OpenAI tool results", () => {
    const messages = buildOpenAIMessages(
      new OpenAIProvider({ apiKey: "test-key" }),
      toolConversation,
    );

    expect(messages[1]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_shell_1",
          type: "function",
          function: {
            name: "shell_exec",
            arguments: JSON.stringify({ command: "ls -F" }),
          },
        },
      ],
    });
    expect(messages[2]).toEqual({
      role: "tool",
      content: JSON.stringify({ error: "Tool call was rejected by the user" }),
      tool_call_id: "call_shell_1",
    });
  });

  it("keeps assistant tool_use blocks before Anthropic tool results", () => {
    const messages = buildAnthropicMessages(
      new AnthropicProvider("test-key"),
      toolConversation,
    );

    expect(messages[1]).toEqual({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call_shell_1",
          name: "shell_exec",
          input: { command: "ls -F" },
        },
      ],
    });
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "call_shell_1",
          content: JSON.stringify({
            error: "Tool call was rejected by the user",
          }),
        },
      ],
    });
  });
});

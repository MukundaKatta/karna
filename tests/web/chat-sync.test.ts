import {
  mapGatewaySessionToChatSession,
  mapGatewayTranscriptMessage,
  mergeAssistantResponse,
  upsertChatSession,
} from "../../apps/web/lib/chat";

describe("chat sync helpers", () => {
  it("maps live gateway sessions into sidebar-friendly chat sessions", () => {
    expect(
      mapGatewaySessionToChatSession({
        id: "session-1",
        channelType: "web",
        channelId: "web-abc123",
        status: "active",
        createdAt: 10,
        updatedAt: 20,
        stats: { messageCount: 3 },
      }),
    ).toEqual({
      id: "session-1",
      title: "Web chat",
      channelType: "web",
      createdAt: 10,
      updatedAt: 20,
      messageCount: 3,
    });
  });

  it("replaces a streamed assistant placeholder with the final response", () => {
    const merged = mergeAssistantResponse(
      [
        {
          id: "user-1",
          role: "user",
          content: "hello",
          timestamp: 100,
        },
        {
          id: "stream-1",
          role: "assistant",
          content: "Gemini",
          timestamp: 110,
          isStreaming: true,
        },
      ],
      {
        id: "final-1",
        role: "assistant",
        content: "Gemini path works.",
        timestamp: 120,
        metadata: { model: "karna-general" },
      },
      "stream-1",
    );

    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({
      id: "stream-1",
      role: "assistant",
      content: "Gemini path works.",
      isStreaming: false,
      metadata: { model: "karna-general" },
    });
  });

  it("does not append a duplicate assistant message when the final response already exists", () => {
    const merged = mergeAssistantResponse(
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Gemini path works.",
          timestamp: 500,
        },
      ],
      {
        id: "assistant-2",
        role: "assistant",
        content: "Gemini path works.",
        timestamp: 750,
      },
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("assistant-1");
    expect(merged[0].content).toBe("Gemini path works.");
  });

  it("keeps the newest session first when a live session is upserted", () => {
    const sessions = upsertChatSession(
      [
        {
          id: "older",
          title: "Web chat",
          channelType: "web",
          createdAt: 1,
          updatedAt: 10,
          messageCount: 1,
        },
      ],
      {
        id: "newer",
        title: "Slack · abc",
        channelType: "slack",
        createdAt: 2,
        updatedAt: 20,
        messageCount: 4,
      },
    );

    expect(sessions.map((session) => session.id)).toEqual(["newer", "older"]);
  });

  it("maps transcript payloads into chat messages without changing assistant content", () => {
    expect(
      mapGatewayTranscriptMessage({
        id: "assistant-1",
        role: "assistant",
        content: "Gemini path works.",
        timestamp: 42,
        metadata: { model: "karna-general", outputTokens: 3 },
      }),
    ).toEqual({
      id: "assistant-1",
      role: "assistant",
      content: "Gemini path works.",
      timestamp: 42,
      metadata: { model: "karna-general", outputTokens: 3 },
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import { LineAdapter } from "../../channels/line/src/adapter.js";
import { MatrixAdapter } from "../../channels/matrix/src/adapter.js";

function createGatewaySocket() {
  const sent: Record<string, unknown>[] = [];
  return {
    OPEN: 1,
    readyState: 1,
    sent,
    send(payload: string) {
      sent.push(JSON.parse(payload));
    },
  };
}

function getPayload(message: Record<string, unknown>): Record<string, unknown> {
  return (message["payload"] as Record<string, unknown>) ?? {};
}

describe("channel routing metadata", () => {
  it("keys LINE sessions by conversation instead of sender id", () => {
    const adapter = new LineAdapter({
      channelAccessToken: "token",
      channelSecret: "secret",
      webhookPort: 0,
      gatewayUrl: "ws://localhost:3000/ws",
    });
    const ws = createGatewaySocket();
    (adapter as any).ws = ws;

    (adapter as any).handleLineEvent({
      type: "message",
      replyToken: "reply-1",
      timestamp: Date.now(),
      source: {
        type: "group",
        userId: "user-1",
        groupId: "group-1",
      },
      message: {
        id: "msg-1",
        type: "text",
        text: "hello from group 1",
      },
    });

    (adapter as any).handleLineEvent({
      type: "message",
      replyToken: "reply-2",
      timestamp: Date.now(),
      source: {
        type: "group",
        userId: "user-1",
        groupId: "group-2",
      },
      message: {
        id: "msg-2",
        type: "text",
        text: "hello from group 2",
      },
    });

    const connectMessages = ws.sent.filter((message) => message.type === "connect");
    const chatMessages = ws.sent.filter((message) => message.type === "chat.message");

    expect(connectMessages).toHaveLength(2);
    expect(connectMessages.map((message) => getPayload(message)["channelId"])).toEqual([
      "group-1",
      "group-2",
    ]);
    expect(
      connectMessages.map(
        (message) => (getPayload(message)["metadata"] as Record<string, unknown>)?.["senderUserId"],
      ),
    ).toEqual(["user-1", "user-1"]);
    expect(
      chatMessages.map(
        (message) => (getPayload(message)["metadata"] as Record<string, unknown>)?.["isDirectMessage"],
      ),
    ).toEqual([false, false]);
    expect((adapter as any).sessionMap.size).toBe(2);
  });

  it("keys Matrix sessions by room instead of sender id", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.example.com",
      accessToken: "token",
      userId: "@karna:example.com",
      gatewayUrl: "ws://localhost:3000/ws",
    });
    const ws = createGatewaySocket();
    (adapter as any).ws = ws;
    (adapter as any).matrixRequest = vi.fn().mockResolvedValue({
      joined: {
        "@karna:example.com": {},
        "@alice:example.com": {},
        "@bob:example.com": {},
      },
    });

    await (adapter as any).handleMatrixEvent("!room-1:example.com", {
      type: "m.room.message",
      event_id: "evt-1",
      sender: "@alice:example.com",
      origin_server_ts: Date.now(),
      content: {
        msgtype: "m.text",
        body: "hello room 1",
      },
    });

    await (adapter as any).handleMatrixEvent("!room-2:example.com", {
      type: "m.room.message",
      event_id: "evt-2",
      sender: "@alice:example.com",
      origin_server_ts: Date.now(),
      content: {
        msgtype: "m.text",
        body: "hello room 2",
      },
    });

    const connectMessages = ws.sent.filter((message) => message.type === "connect");
    const chatMessages = ws.sent.filter((message) => message.type === "chat.message");

    expect(connectMessages).toHaveLength(2);
    expect(connectMessages.map((message) => getPayload(message)["channelId"])).toEqual([
      "!room-1:example.com",
      "!room-2:example.com",
    ]);
    expect(
      connectMessages.map(
        (message) => (getPayload(message)["metadata"] as Record<string, unknown>)?.["isDirectMessage"],
      ),
    ).toEqual([false, false]);
    expect(
      chatMessages.map(
        (message) => (getPayload(message)["metadata"] as Record<string, unknown>)?.["senderUserId"],
      ),
    ).toEqual(["@alice:example.com", "@alice:example.com"]);
    expect((adapter as any).sessionMap.size).toBe(2);
  });
});

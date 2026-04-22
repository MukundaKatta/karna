import { describe, expect, it, vi } from "vitest";
import { LineAdapter } from "../../channels/line/src/adapter.js";
import { MatrixAdapter } from "../../channels/matrix/src/adapter.js";
import { GoogleChatAdapter } from "../../channels/google-chat/src/adapter.js";
import { WebChatServer } from "../../channels/webchat/src/server.js";
import { SlackAdapter } from "../../channels/slack/src/adapter.js";
import { DiscordAdapter } from "../../channels/discord/src/adapter.js";
import { TelegramAdapter } from "../../channels/telegram/src/adapter.js";
import { WhatsAppAdapter } from "../../channels/whatsapp/src/adapter.js";
import { SignalAdapter } from "../../channels/signal/src/adapter.js";
import { SMSAdapter } from "../../channels/sms/src/adapter.js";

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

  it("keys Google Chat sessions by space and thread instead of sender id", () => {
    const adapter = new GoogleChatAdapter({
      serviceAccountPath: "/tmp/fake-google-service-account.json",
      spaceId: "spaces/default",
      gatewayUrl: "ws://localhost:3000/ws",
    });
    const ws = createGatewaySocket();
    (adapter as any).ws = ws;

    (adapter as any).handleIncomingEvent(
      JSON.stringify({
        type: "MESSAGE",
        message: {
          name: "spaces/AAA/messages/1",
          sender: {
            name: "users/123",
            displayName: "Alice",
            type: "HUMAN",
          },
          createTime: new Date().toISOString(),
          text: "hello from thread 1",
          thread: { name: "spaces/AAA/threads/1" },
          space: {
            name: "spaces/AAA",
            type: "SPACE",
          },
        },
      }),
    );

    (adapter as any).handleIncomingEvent(
      JSON.stringify({
        type: "MESSAGE",
        message: {
          name: "spaces/BBB/messages/2",
          sender: {
            name: "users/123",
            displayName: "Alice",
            type: "HUMAN",
          },
          createTime: new Date().toISOString(),
          text: "hello from thread 2",
          thread: { name: "spaces/BBB/threads/2" },
          space: {
            name: "spaces/BBB",
            type: "SPACE",
          },
        },
      }),
    );

    const connectMessages = ws.sent.filter((message) => message.type === "connect");
    expect(connectMessages).toHaveLength(2);
    expect(connectMessages.map((message) => getPayload(message)["channelId"])).toEqual([
      "spaces/AAA:spaces/AAA/threads/1",
      "spaces/BBB:spaces/BBB/threads/2",
    ]);
    expect(
      connectMessages.map(
        (message) => (getPayload(message)["metadata"] as Record<string, unknown>)?.["userId"],
      ),
    ).toEqual(["users/123", "users/123"]);
    expect((adapter as any).sessionMap.size).toBe(2);
  });

  it("re-registers active webchat sessions when the gateway reconnects", () => {
    const server = new WebChatServer({
      gatewayUrl: "ws://localhost:3000/ws",
      port: 0,
    });
    const gatewayWs = createGatewaySocket();
    (server as any).gatewayWs = gatewayWs;
    (server as any).sessions.set("client-1", {
      clientWs: {
        OPEN: 1,
        readyState: 1,
        send() {},
      },
      sessionId: "session-1",
      clientId: "client-1",
      connectedAt: Date.now(),
    });

    (server as any).reregisterActiveSessions();

    expect(gatewayWs.sent).toHaveLength(1);
    expect(gatewayWs.sent[0]).toMatchObject({
      type: "connect",
      sessionId: "session-1",
      payload: {
        channelType: "webchat",
        channelId: "client-1",
      },
    });
  });

  it("re-registers active Slack sessions when the gateway reconnects", () => {
    const adapter = new SlackAdapter({
      botToken: "xoxb-test",
      appToken: "xapp-test",
      signingSecret: "secret",
      gatewayUrl: "ws://localhost:3000/ws",
    });
    const ws = createGatewaySocket();
    (adapter as any).ws = ws;
    (adapter as any).sessionMap.set("C123:thread-1", {
      sessionId: "session-1",
      threadTs: "thread-1",
    });

    (adapter as any).reregisterSessions();

    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).toMatchObject({
      type: "connect",
      sessionId: "session-1",
      payload: {
        channelType: "slack",
        channelId: "C123",
        metadata: {
          channel: "C123",
          threadTs: "thread-1",
        },
      },
    });
  });

  it("re-registers active Discord sessions when the gateway reconnects", () => {
    const adapter = new DiscordAdapter({
      botToken: "discord-token",
      clientId: "client-id",
      gatewayUrl: "ws://localhost:3000/ws",
    });
    const ws = createGatewaySocket();
    (adapter as any).ws = ws;
    (adapter as any).sessionMap.set("channel-1", "session-1");

    (adapter as any).reregisterSessions();

    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).toMatchObject({
      type: "connect",
      sessionId: "session-1",
      payload: {
        channelType: "discord",
        channelId: "channel-1",
        metadata: { channelId: "channel-1" },
      },
    });
  });

  it("re-registers active Telegram sessions when the gateway reconnects", () => {
    const adapter = new TelegramAdapter({
      botToken: "123456:telegram-test-token",
      gatewayUrl: "ws://localhost:3000/ws",
    });
    const ws = createGatewaySocket();
    (adapter as any).ws = ws;
    (adapter as any).sessionMap.set(123456789, "session-1");

    (adapter as any).reregisterSessions();

    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).toMatchObject({
      type: "connect",
      sessionId: "session-1",
      payload: {
        channelType: "telegram",
        channelId: "123456789",
        metadata: { chatId: 123456789 },
      },
    });
  });

  it("re-registers active WhatsApp sessions when the gateway reconnects", () => {
    const adapter = new WhatsAppAdapter({
      gatewayUrl: "ws://localhost:3000/ws",
    });
    const ws = createGatewaySocket();
    (adapter as any).ws = ws;
    (adapter as any).sessionMap.set("15551234567@s.whatsapp.net", "session-1");

    (adapter as any).reregisterSessions();

    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).toMatchObject({
      type: "connect",
      sessionId: "session-1",
      payload: {
        channelType: "whatsapp",
        channelId: "15551234567@s.whatsapp.net",
        metadata: {
          jid: "15551234567@s.whatsapp.net",
          conversationType: "dm",
          isDirectMessage: true,
        },
      },
    });
  });

  it("re-registers active Signal sessions when the gateway reconnects", () => {
    const adapter = new SignalAdapter({
      signalApiUrl: "http://localhost:8080",
      signalNumber: "+15557654321",
      gatewayUrl: "ws://localhost:3000/ws",
    });
    const ws = createGatewaySocket();
    (adapter as any).ws = ws;
    (adapter as any).sessionMap.set("+15551234567", "session-1");

    (adapter as any).reregisterSessions();

    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).toMatchObject({
      type: "connect",
      sessionId: "session-1",
      payload: {
        channelType: "signal",
        channelId: "+15551234567",
        metadata: {
          phoneNumber: "+15551234567",
          conversationType: "dm",
          isDirectMessage: true,
        },
      },
    });
  });

  it("re-registers active SMS sessions when the gateway reconnects", () => {
    const adapter = new SMSAdapter({
      accountSid: "AC123",
      authToken: "token",
      phoneNumber: "+15550000000",
      gatewayUrl: "ws://localhost:3000/ws",
    });
    const ws = createGatewaySocket();
    (adapter as any).ws = ws;
    (adapter as any).sessionMap.set("+15551234567", "session-1");

    (adapter as any).reregisterSessions();

    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).toMatchObject({
      type: "connect",
      sessionId: "session-1",
      payload: {
        channelType: "sms",
        channelId: "+15551234567",
        metadata: {
          phoneNumber: "+15551234567",
          conversationType: "dm",
          isDirectMessage: true,
        },
      },
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBrowserRuntimeConfigForTesting,
} from "../../apps/web/lib/browser-runtime-config";
import { WSClient } from "../../apps/web/lib/ws";

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
const originalWindow = globalThis.window;
const originalNodeEnv = process.env["NODE_ENV"];
const originalPublicGatewayUrl = process.env["NEXT_PUBLIC_GATEWAY_URL"];
const originalPublicWsUrl = process.env["NEXT_PUBLIC_WS_URL"];

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: Array<Record<string, unknown>> = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("websocket runtime config", () => {
  beforeEach(() => {
    clearBrowserRuntimeConfigForTesting();
    MockWebSocket.instances = [];
    process.env["NODE_ENV"] = "production";
    delete process.env["NEXT_PUBLIC_GATEWAY_URL"];
    delete process.env["NEXT_PUBLIC_WS_URL"];
    globalThis.window = {} as Window & typeof globalThis;
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    clearBrowserRuntimeConfigForTesting();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    globalThis.window = originalWindow;

    if (originalNodeEnv === undefined) {
      delete process.env["NODE_ENV"];
    } else {
      process.env["NODE_ENV"] = originalNodeEnv;
    }

    if (originalPublicGatewayUrl === undefined) {
      delete process.env["NEXT_PUBLIC_GATEWAY_URL"];
    } else {
      process.env["NEXT_PUBLIC_GATEWAY_URL"] = originalPublicGatewayUrl;
    }

    if (originalPublicWsUrl === undefined) {
      delete process.env["NEXT_PUBLIC_WS_URL"];
    } else {
      process.env["NEXT_PUBLIC_WS_URL"] = originalPublicWsUrl;
    }
  });

  it("fetches runtime config before opening the websocket in the browser", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          gatewayUrl: "https://karna-gateway.onrender.com",
          webSocketUrl: "wss://karna-gateway.onrender.com/ws",
          configured: true,
          error: null,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    ) as typeof fetch;

    const client = new WSClient();
    client.connect("web-runtime-test");

    await vi.waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });
    expect(MockWebSocket.instances[0]?.url).toBe("wss://karna-gateway.onrender.com/ws");
    await vi.waitFor(() => {
      expect(client.state).toBe("connected");
    });
    expect(client.currentConfigurationError).toBeNull();
  });

  it("queues chat messages until connect.ack provides a session id", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          gatewayUrl: "https://karna-gateway.onrender.com",
          webSocketUrl: "wss://karna-gateway.onrender.com/ws",
          configured: true,
          error: null,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    ) as typeof fetch;

    const client = new WSClient();
    client.connect("web-runtime-test");

    await vi.waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });
    const socket = MockWebSocket.instances[0]!;

    await vi.waitFor(() => {
      expect(socket.sent[0]?.type).toBe("connect");
    });

    client.sendMessage("hello from prod");
    expect(socket.sent).toHaveLength(1);

    socket.onmessage?.({
      data: JSON.stringify({
        id: "ack-1",
        type: "connect.ack",
        timestamp: Date.now(),
        payload: {
          sessionId: "session-1",
          channelId: "web-runtime-test",
          token: "token-1",
          expiresAt: Date.now() + 60_000,
        },
      }),
    });

    await vi.waitFor(() => {
      expect(socket.sent).toHaveLength(2);
    });
    expect(socket.sent[1]).toMatchObject({
      type: "chat.message",
      sessionId: "session-1",
      payload: {
        content: "hello from prod",
        role: "user",
      },
    });
  });

  it("surfaces a connect challenge as a browser configuration error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          gatewayUrl: "https://karna-gateway.onrender.com",
          webSocketUrl: "wss://karna-gateway.onrender.com/ws",
          configured: true,
          error: null,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    ) as typeof fetch;

    const client = new WSClient();
    client.connect("web-runtime-test");

    await vi.waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });
    const socket = MockWebSocket.instances[0]!;

    socket.onmessage?.({
      data: JSON.stringify({
        id: "challenge-1",
        type: "connect.challenge",
        timestamp: Date.now(),
        payload: {
          challenge: "nonce",
          expiresAt: Date.now() + 30_000,
        },
      }),
    });

    await vi.waitFor(() => {
      expect(client.state).toBe("error");
    });
    expect(client.currentConfigurationError).toContain("Gateway authentication");
  });
});

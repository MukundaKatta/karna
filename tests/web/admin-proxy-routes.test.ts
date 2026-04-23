import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalNodeEnv = process.env["NODE_ENV"];
const originalGatewayUrl = process.env["GATEWAY_URL"];
const originalFetch = globalThis.fetch;

vi.mock("@/lib/runtime-config", () => ({
  resolveServerGatewayUrl: () => ({
    url: "https://karna-gateway.onrender.com",
    error: null,
  }),
}));

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function createProxyRequest(
  url: string,
  init: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const headers = new Headers(init.headers);
  return {
    method: init.method ?? "GET",
    nextUrl: new URL(url),
    headers,
    text: vi.fn().mockResolvedValue(init.body ?? ""),
  };
}

describe("web admin proxy routes", () => {
  beforeEach(() => {
    process.env["NODE_ENV"] = "production";
    process.env["GATEWAY_URL"] = "https://karna-gateway.onrender.com";
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;
  });

  afterEach(() => {
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv("GATEWAY_URL", originalGatewayUrl);
    globalThis.fetch = originalFetch;
  });

  it("proxies memory creation through the hosted web layer", async () => {
    const request = createProxyRequest("https://karna-web.onrender.com/api/memory", {
      method: "POST",
      body: JSON.stringify({ agentId: "karna-general", content: "remember this" }),
      headers: { "content-type": "application/json" },
    });
    const { POST } = await import("../../apps/web/app/api/memory/route");

    await POST(request as never);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://karna-gateway.onrender.com/api/memory",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ agentId: "karna-general", content: "remember this" }),
      }),
    );
  });

  it("proxies session spawning through the hosted web layer", async () => {
    const request = createProxyRequest("https://karna-web.onrender.com/api/sessions/spawn", {
      method: "POST",
      body: JSON.stringify({ agentId: "karna-general", channelType: "web" }),
      headers: { "content-type": "application/json" },
    });
    const { POST } = await import("../../apps/web/app/api/sessions/spawn/route");

    await POST(request as never);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://karna-gateway.onrender.com/api/sessions/spawn",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("proxies session message injection through the hosted web layer", async () => {
    const request = createProxyRequest(
      "https://karna-web.onrender.com/api/sessions/session-123/message",
      {
        method: "POST",
        body: JSON.stringify({ content: "Reply back", replyBack: true }),
        headers: { "content-type": "application/json" },
      },
    );
    const { POST } = await import("../../apps/web/app/api/sessions/[id]/message/route");

    await POST(request as never, { params: Promise.resolve({ id: "session-123" }) });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://karna-gateway.onrender.com/api/sessions/session-123/message",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("proxies session history deletion through the hosted web layer", async () => {
    const request = createProxyRequest(
      "https://karna-web.onrender.com/api/sessions/session-123/history",
      {
        method: "DELETE",
      },
    );
    const { DELETE } = await import("../../apps/web/app/api/sessions/[id]/history/route");

    await DELETE(request as never, { params: Promise.resolve({ id: "session-123" }) });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://karna-gateway.onrender.com/api/sessions/session-123/history",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });

  it("proxies session summary reads through the hosted web layer", async () => {
    const request = createProxyRequest(
      "https://karna-web.onrender.com/api/sessions/summary?staleAfterMs=60000",
    );
    const { GET } = await import("../../apps/web/app/api/sessions/summary/route");

    await GET(request as never);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://karna-gateway.onrender.com/api/sessions/summary?staleAfterMs=60000",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });
});

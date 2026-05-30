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

describe("web dashboard data routes", () => {
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

  it("proxies cost tracking reads and forwards query params (#578)", async () => {
    const request = createProxyRequest(
      "https://karna-web.onrender.com/api/costs?groupBy=model&from=1000&to=2000",
    );
    const { GET } = await import("../../apps/web/app/api/costs/route");

    const response = await GET(request as never);

    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://karna-gateway.onrender.com/api/costs?groupBy=model&from=1000&to=2000",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("proxies usage dashboard reads and forwards query params (#579)", async () => {
    const request = createProxyRequest(
      "https://karna-web.onrender.com/api/usage?channel=telegram&granularity=day",
    );
    const { GET } = await import("../../apps/web/app/api/usage/route");

    const response = await GET(request as never);

    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://karna-gateway.onrender.com/api/usage?channel=telegram&granularity=day",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("proxies eval run list reads (#574)", async () => {
    const request = createProxyRequest(
      "https://karna-web.onrender.com/api/evals?status=passed&limit=20",
    );
    const { GET } = await import("../../apps/web/app/api/evals/route");

    await GET(request as never);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://karna-gateway.onrender.com/api/evals?status=passed&limit=20",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("proxies eval run detail reads by id (#574)", async () => {
    const request = createProxyRequest(
      "https://karna-web.onrender.com/api/evals/run-123",
    );
    const { GET } = await import("../../apps/web/app/api/evals/[id]/route");

    await GET(request as never, { params: Promise.resolve({ id: "run-123" }) });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://karna-gateway.onrender.com/api/evals/run-123",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("propagates gateway 404 for an unknown eval run (#574)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;
    const request = createProxyRequest(
      "https://karna-web.onrender.com/api/evals/missing",
    );
    const { GET } = await import("../../apps/web/app/api/evals/[id]/route");

    const response = await GET(request as never, {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(response.status).toBe(404);
  });

  it("proxies session replay reads by id (#582)", async () => {
    const request = createProxyRequest(
      "https://karna-web.onrender.com/api/sessions/session-123/replay?limit=50",
    );
    const { GET } = await import(
      "../../apps/web/app/api/sessions/[id]/replay/route"
    );

    await GET(request as never, {
      params: Promise.resolve({ id: "session-123" }),
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://karna-gateway.onrender.com/api/sessions/session-123/replay?limit=50",
      expect.objectContaining({ method: "GET" }),
    );
  });
});

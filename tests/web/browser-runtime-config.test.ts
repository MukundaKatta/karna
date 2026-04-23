import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBrowserRuntimeConfigForTesting,
  getBrowserRuntimeConfig,
} from "../../apps/web/lib/browser-runtime-config";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

describe("browser runtime config", () => {
  beforeEach(() => {
    clearBrowserRuntimeConfigForTesting();
    globalThis.window = {} as Window & typeof globalThis;
  });

  afterEach(() => {
    clearBrowserRuntimeConfigForTesting();
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  });

  it("loads and caches runtime config from the web api", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          gatewayUrl: "https://karna-gateway.onrender.com",
          webSocketUrl: "wss://karna-gateway.onrender.com/ws",
          error: null,
          configured: true,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const first = await getBrowserRuntimeConfig();
    const second = await getBrowserRuntimeConfig();

    expect(first).toEqual({
      gatewayUrl: "https://karna-gateway.onrender.com",
      webSocketUrl: "wss://karna-gateway.onrender.com/ws",
      error: null,
    });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/runtime-config", { cache: "no-store" });
  });

  it("returns a clear error when runtime config cannot be fetched", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down")) as typeof fetch;

    await expect(getBrowserRuntimeConfig()).resolves.toEqual({
      gatewayUrl: null,
      webSocketUrl: null,
      error: "Failed to load browser runtime configuration",
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearWebSearchStateForTests,
  webImageSearchTool,
  webReadTool,
  webSearchTool,
  webSummarizeTool,
} from "../../agent/src/tools/builtin/web-search.js";
import type { ToolExecutionContext } from "../../agent/src/tools/registry.js";

const context: ToolExecutionContext = {
  agentId: "agent-web",
  sessionId: "session-web",
  workingDirectory: process.cwd(),
};

describe("web search tools", () => {
  const originalTavily = process.env.TAVILY_API_KEY;
  const originalSerp = process.env.SERPAPI_API_KEY;

  beforeEach(() => {
    clearWebSearchStateForTests();
    process.env.TAVILY_API_KEY = "test-tavily";
    delete process.env.SERPAPI_API_KEY;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          results: [
            {
              title: "Karna",
              url: "https://example.com/karna",
              content: "Current Karna information",
            },
          ],
          images: ["https://example.com/image.png"],
        }),
        text: async () =>
          "<html><head><title>Demo</title><style>hidden</style></head><body><h1>Hello</h1><script>hidden()</script><p>First sentence. Second sentence. Third sentence.</p></body></html>",
      })),
    );
  });

  afterEach(() => {
    process.env.TAVILY_API_KEY = originalTavily;
    process.env.SERPAPI_API_KEY = originalSerp;
    vi.unstubAllGlobals();
  });

  it("searches Tavily with safe search, citations, and one-hour cache", async () => {
    const first = await webSearchTool.execute(
      { query: "karna ai", maxResults: 1 },
      context,
    );
    const second = await webSearchTool.execute(
      { query: "karna ai", maxResults: 1 },
      context,
    );

    expect(first).toMatchObject({
      query: "karna ai",
      provider: "tavily",
      results: [
        {
          title: "Karna",
          url: "https://example.com/karna",
          citation: "[1] https://example.com/karna",
        },
      ],
    });
    expect(second).toMatchObject({ cached: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      safe_search: true,
      max_results: 1,
    });
  });

  it("reads and summarizes web pages with source citations", async () => {
    const read = await webReadTool.execute(
      { url: "https://example.com/page", maxCharacters: 500 },
      context,
    );
    const summary = await webSummarizeTool.execute(
      { url: "https://example.com/page", maxCharacters: 500 },
      context,
    );

    expect(read).toMatchObject({
      url: "https://example.com/page",
      title: "Demo",
      citation: "https://example.com/page",
    });
    expect(JSON.stringify(read)).toContain("Hello First sentence");
    expect(JSON.stringify(read)).not.toContain("hidden()");
    expect(summary).toMatchObject({
      title: "Demo",
      citation: "https://example.com/page",
    });
    expect((summary as { summary: string[] }).summary.length).toBeGreaterThan(0);
  });

  it("supports image search and per-session rate limiting", async () => {
    const images = await webImageSearchTool.execute(
      { query: "karna logo", maxResults: 1 },
      context,
    );
    expect(images).toMatchObject({
      query: "karna logo",
      provider: "tavily",
      images: [
        {
          url: "https://example.com/image.png",
          citation: "[1] https://example.com/image.png",
        },
      ],
    });

    for (let index = 0; index < 29; index += 1) {
      await webReadTool.execute({ url: `https://example.com/${index}` }, context);
    }

    await expect(
      webReadTool.execute({ url: "https://example.com/blocked" }, context),
    ).rejects.toThrow("rate limit exceeded");
  });
});

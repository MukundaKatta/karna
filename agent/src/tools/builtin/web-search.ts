// ─── Web Search Tool ───────────────────────────────────────────────────────

import { z } from "zod";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../registry.js";

const WebSearchInputSchema = z.object({
  query: z.string().min(1).max(500).describe("The search query"),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe("Maximum number of results to return (default: 5)"),
});

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  position: number;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  totalResults?: number;
  provider: string;
}

/**
 * Supported search providers.
 */
type SearchProvider = "serpapi" | "tavily";

/**
 * Web search tool using a configurable search provider (SerpAPI or Tavily).
 * Risk level: LOW - read-only information retrieval.
 */
export const webSearchTool: ToolDefinitionRuntime = {
  name: "web_search",
  description:
    "Search the web for current information. Returns titles, URLs, and snippets. " +
    "Use when you need up-to-date information not available in your training data.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query",
      },
      maxResults: {
        type: "integer",
        description: "Maximum number of results to return (default: 5)",
        minimum: 1,
        maximum: 20,
      },
    },
    required: ["query"],
  },
  inputSchema: WebSearchInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 15_000,
  tags: ["web", "search", "information"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<WebSearchResponse> {
    const parsed = WebSearchInputSchema.parse(input);
    const provider = detectProvider();

    switch (provider) {
      case "tavily":
        return searchTavily(parsed.query, parsed.maxResults);
      case "serpapi":
        return searchSerpApi(parsed.query, parsed.maxResults);
      default:
        throw new Error(
          "No search provider configured. Set TAVILY_API_KEY or SERPAPI_API_KEY."
        );
    }
  },
};

// ─── Provider Detection ─────────────────────────────────────────────────────

function detectProvider(): SearchProvider {
  if (process.env.TAVILY_API_KEY) return "tavily";
  if (process.env.SERPAPI_API_KEY) return "serpapi";
  throw new Error(
    "No search provider configured. Set TAVILY_API_KEY or SERPAPI_API_KEY environment variable."
  );
}

// ─── Tavily Search ──────────────────────────────────────────────────────────

async function searchTavily(
  query: string,
  maxResults: number
): Promise<WebSearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY not set");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: false,
    }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    results: Array<{ title: string; url: string; content: string }>;
  };

  return {
    query,
    provider: "tavily",
    results: data.results.map((r, i) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      position: i + 1,
    })),
  };
}

// ─── SerpAPI Search ─────────────────────────────────────────────────────────

async function searchSerpApi(
  query: string,
  maxResults: number
): Promise<WebSearchResponse> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) throw new Error("SERPAPI_API_KEY not set");

  const params = new URLSearchParams({
    api_key: apiKey,
    q: query,
    num: String(maxResults),
    engine: "google",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const response = await fetch(`https://serpapi.com/search?${params.toString()}`, {
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`SerpAPI error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    organic_results?: Array<{ title: string; link: string; snippet: string; position: number }>;
    search_information?: { total_results: number };
  };

  const results = (data.organic_results ?? []).slice(0, maxResults);

  return {
    query,
    provider: "serpapi",
    totalResults: data.search_information?.total_results,
    results: results.map((r) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet,
      position: r.position,
    })),
  };
}

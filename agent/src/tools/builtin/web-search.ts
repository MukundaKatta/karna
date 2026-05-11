// ─── Web Search Tool ───────────────────────────────────────────────────────

import { z } from "zod";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../registry.js";

const SEARCH_CACHE_TTL_MS = 60 * 60 * 1000;
const SESSION_RATE_LIMIT = 30;
const SESSION_RATE_WINDOW_MS = 60 * 1000;

const searchCache = new Map<string, { expiresAt: number; value: WebSearchResponse }>();
const sessionBuckets = new Map<string, { count: number; resetAt: number }>();

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
  safeSearch: z.boolean().optional().default(true).describe("Enable safe search filtering"),
});

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  position: number;
  citation: string;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  totalResults?: number;
  provider: string;
  cached?: boolean;
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
    context: ToolExecutionContext
  ): Promise<WebSearchResponse> {
    const parsed = WebSearchInputSchema.parse(input);
    checkRateLimit(context.sessionId);
    const provider = detectProvider();
    const cacheKey = `${provider}:${parsed.safeSearch}:${parsed.maxResults}:${parsed.query}`;
    const cached = searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.value, cached: true };
    }

    const response = await (async () => {
      switch (provider) {
      case "tavily":
        return searchTavily(parsed.query, parsed.maxResults, parsed.safeSearch);
      case "serpapi":
        return searchSerpApi(parsed.query, parsed.maxResults, parsed.safeSearch);
      default:
        throw new Error(
          "No search provider configured. Set TAVILY_API_KEY or SERPAPI_API_KEY."
        );
      }
    })();

    searchCache.set(cacheKey, {
      expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
      value: response,
    });
    return response;
  },
};

// ─── Web Read Tool ─────────────────────────────────────────────────────────

const WebReadInputSchema = z.object({
  url: z.string().url().describe("HTTP or HTTPS URL to fetch and extract text from"),
  maxCharacters: z
    .number()
    .int()
    .min(500)
    .max(30_000)
    .optional()
    .default(12_000)
    .describe("Maximum extracted characters to return"),
});

export interface WebReadResponse {
  url: string;
  title?: string;
  content: string;
  citation: string;
  characters: number;
}

export const webReadTool: ToolDefinitionRuntime = {
  name: "web_read",
  description:
    "Fetch a web page and extract readable text content with a source citation.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "HTTP or HTTPS URL to read" },
      maxCharacters: {
        type: "integer",
        description: "Maximum extracted characters to return",
        minimum: 500,
        maximum: 30_000,
      },
    },
    required: ["url"],
  },
  inputSchema: WebReadInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 15_000,
  tags: ["web", "read", "information"],

  async execute(
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<WebReadResponse> {
    const parsed = WebReadInputSchema.parse(input);
    checkRateLimit(context.sessionId);
    return readWebPage(parsed.url, parsed.maxCharacters);
  },
};

// ─── Web Summarize Tool ────────────────────────────────────────────────────

const WebSummarizeInputSchema = z.object({
  url: z.string().url().describe("HTTP or HTTPS URL to summarize"),
  maxCharacters: z
    .number()
    .int()
    .min(500)
    .max(30_000)
    .optional()
    .default(12_000)
    .describe("Maximum extracted characters to inspect"),
});

export const webSummarizeTool: ToolDefinitionRuntime = {
  name: "web_summarize",
  description:
    "Fetch a web page and return a compact extractive summary with source citation.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "HTTP or HTTPS URL to summarize" },
      maxCharacters: {
        type: "integer",
        description: "Maximum extracted characters to inspect",
        minimum: 500,
        maximum: 30_000,
      },
    },
    required: ["url"],
  },
  inputSchema: WebSummarizeInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 15_000,
  tags: ["web", "summarize", "information"],

  async execute(input: Record<string, unknown>, context: ToolExecutionContext) {
    const parsed = WebSummarizeInputSchema.parse(input);
    checkRateLimit(context.sessionId);
    const page = await readWebPage(parsed.url, parsed.maxCharacters);
    return {
      url: page.url,
      title: page.title,
      summary: summarizeText(page.content),
      citation: page.citation,
    };
  },
};

// ─── Web Image Search Tool ─────────────────────────────────────────────────

const WebImageSearchInputSchema = WebSearchInputSchema;

export const webImageSearchTool: ToolDefinitionRuntime = {
  name: "web_image_search",
  description:
    "Search the web for images using the configured search provider. Returns image URLs and source citations.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The image search query" },
      maxResults: {
        type: "integer",
        description: "Maximum number of image results",
        minimum: 1,
        maximum: 20,
      },
      safeSearch: { type: "boolean", description: "Enable safe search filtering" },
    },
    required: ["query"],
  },
  inputSchema: WebImageSearchInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 15_000,
  tags: ["web", "image", "search"],

  async execute(input: Record<string, unknown>, context: ToolExecutionContext) {
    const parsed = WebImageSearchInputSchema.parse(input);
    checkRateLimit(context.sessionId);
    const provider = detectProvider();
    if (provider === "tavily") {
      return searchTavilyImages(parsed.query, parsed.maxResults, parsed.safeSearch);
    }
    return searchSerpApiImages(parsed.query, parsed.maxResults, parsed.safeSearch);
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
  maxResults: number,
  safeSearch: boolean
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
      include_images: false,
      search_depth: "basic",
      topic: "general",
      safe_search: safeSearch,
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
      citation: `[${i + 1}] ${r.url}`,
    })),
  };
}

// ─── SerpAPI Search ─────────────────────────────────────────────────────────

async function searchSerpApi(
  query: string,
  maxResults: number,
  safeSearch: boolean
): Promise<WebSearchResponse> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) throw new Error("SERPAPI_API_KEY not set");

  const params = new URLSearchParams({
    api_key: apiKey,
    q: query,
    num: String(maxResults),
    engine: "google",
    safe: safeSearch ? "active" : "off",
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
      citation: `[${r.position}] ${r.link}`,
    })),
  };
}

async function searchTavilyImages(
  query: string,
  maxResults: number,
  safeSearch: boolean
) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY not set");

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: false,
      include_images: true,
      safe_search: safeSearch,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { images?: string[] };
  return {
    query,
    provider: "tavily",
    images: (data.images ?? []).slice(0, maxResults).map((url, index) => ({
      url,
      position: index + 1,
      citation: `[${index + 1}] ${url}`,
    })),
  };
}

async function searchSerpApiImages(
  query: string,
  maxResults: number,
  safeSearch: boolean
) {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) throw new Error("SERPAPI_API_KEY not set");

  const params = new URLSearchParams({
    api_key: apiKey,
    q: query,
    num: String(maxResults),
    engine: "google_images",
    safe: safeSearch ? "active" : "off",
  });
  const response = await fetch(`https://serpapi.com/search?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`SerpAPI error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    images_results?: Array<{ title?: string; original?: string; link?: string; source?: string }>;
  };

  return {
    query,
    provider: "serpapi",
    images: (data.images_results ?? []).slice(0, maxResults).map((image, index) => ({
      title: image.title,
      url: image.original ?? image.link,
      source: image.source,
      position: index + 1,
      citation: `[${index + 1}] ${image.link ?? image.original ?? image.source ?? ""}`,
    })),
  };
}

async function readWebPage(
  url: string,
  maxCharacters: number
): Promise<WebReadResponse> {
  const parsedUrl = new URL(url);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported");
  }

  const response = await fetch(parsedUrl.toString(), {
    headers: {
      "User-Agent": "KarnaAgent/1.0 (+https://github.com/MukundaKatta/karna)",
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`Fetch error: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const title = extractTitle(html);
  const content = extractReadableText(html).slice(0, maxCharacters);
  return {
    url: parsedUrl.toString(),
    title,
    content,
    characters: content.length,
    citation: parsedUrl.toString(),
  };
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(match[1]!).trim() : undefined;
}

function extractReadableText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function summarizeText(content: string): string[] {
  const sentences = content
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  return sentences.slice(0, 5);
}

function checkRateLimit(sessionId: string): void {
  const now = Date.now();
  const bucket = sessionBuckets.get(sessionId);
  if (!bucket || bucket.resetAt <= now) {
    sessionBuckets.set(sessionId, {
      count: 1,
      resetAt: now + SESSION_RATE_WINDOW_MS,
    });
    return;
  }

  if (bucket.count >= SESSION_RATE_LIMIT) {
    throw new Error("Web tool rate limit exceeded for this session. Try again shortly.");
  }

  bucket.count += 1;
}

export function clearWebSearchStateForTests(): void {
  searchCache.clear();
  sessionBuckets.clear();
}

// ─── Memory Tools ───────────────────────────────────────────────────────────
// Expose memory search and retrieval as first-class agent tools.
// Allows the agent to explicitly search and retrieve its own memories.

import { z } from "zod";
import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../registry.js";

const logger = pino({ name: "tool-memory" });

// ─── Memory Search ──────────────────────────────────────────────────────────

const MemorySearchInputSchema = z.object({
  query: z.string().min(1).describe("Search query for memories"),
  limit: z.number().int().min(1).max(50).optional().describe("Max results. Default: 10"),
  category: z.string().optional().describe("Filter by category (e.g., 'fact', 'preference', 'rag')"),
  tags: z.array(z.string()).optional().describe("Filter by tags"),
});

export const memorySearchTool: ToolDefinitionRuntime = {
  name: "memory_search",
  description:
    "Search your long-term memory for relevant information. " +
    "Use this when you need to recall facts, preferences, or context from past conversations. " +
    "Results are ranked by relevance.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      limit: { type: "integer", description: "Max results (1-50)", minimum: 1, maximum: 50 },
      category: { type: "string", description: "Filter by category" },
      tags: { type: "array", description: "Filter by tags", items: { type: "string" } },
    },
    required: ["query"],
  },
  inputSchema: MemorySearchInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 10_000,
  tags: ["memory", "search"],

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
    const params = MemorySearchInputSchema.parse(input);
    logger.debug({ query: params.query, sessionId: context.sessionId }, "Memory search");

    // Memory search is injected by the runtime via context
    // For now, return a structured response indicating the search was requested
    return {
      query: params.query,
      limit: params.limit ?? 10,
      category: params.category,
      tags: params.tags,
      results: [],
      note: "Memory search results are populated by the runtime memory manager",
    };
  },
};

// ─── Memory Get ─────────────────────────────────────────────────────────────

const MemoryGetInputSchema = z.object({
  id: z.string().min(1).describe("Memory entry ID to retrieve"),
});

export const memoryGetTool: ToolDefinitionRuntime = {
  name: "memory_get",
  description:
    "Retrieve a specific memory entry by its ID. " +
    "Use after memory_search to get the full content of a relevant memory.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Memory entry ID" },
    },
    required: ["id"],
  },
  inputSchema: MemoryGetInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 5_000,
  tags: ["memory"],

  async execute(input: Record<string, unknown>, _context: ToolExecutionContext): Promise<unknown> {
    const params = MemoryGetInputSchema.parse(input);
    logger.debug({ memoryId: params.id }, "Memory get");

    return {
      id: params.id,
      entry: null,
      note: "Memory retrieval is handled by the runtime memory manager",
    };
  },
};

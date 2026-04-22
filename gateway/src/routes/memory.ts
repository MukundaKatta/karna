import type { FastifyInstance } from "fastify";
import {
  CreateMemoryInputSchema,
  type CreateMemoryInput,
  MemorySourceSchema,
} from "@karna/shared/types/memory.js";
import type { MemoryStore } from "@karna/agent/memory/store.js";
import { DEFAULT_AGENTS } from "../catalog/default-agents.js";

interface MemorySearchBody {
  agentId: string;
  embedding: number[];
  limit?: number;
  minRelevance?: number;
  category?: string;
  tags?: string[];
  source?: CreateMemoryInput["source"];
}

interface MemoryCreateBody extends CreateMemoryInput {
  agentId: string;
}

interface MemoryListQuerystring {
  agentId?: string;
  query?: string;
  category?: string;
  source?: string;
  limit?: string | number;
  offset?: string | number;
}

export function registerMemoryRoutes(app: FastifyInstance, memoryStore: MemoryStore): void {
  app.get<{ Querystring: MemoryListQuerystring }>("/api/memory", async (request, reply) => {
    const limit = parsePositiveInt(request.query?.limit, 100);
    const offset = parseNonNegativeInt(request.query?.offset, 0);
    const query = request.query?.query?.trim();
    const category = request.query?.category?.trim();
    const agentId = request.query?.agentId?.trim();
    const source = request.query?.source?.trim();

    if (limit === null) {
      return reply.status(400).send({ error: "limit must be a positive integer" });
    }
    if (offset === null) {
      return reply.status(400).send({ error: "offset must be a non-negative integer" });
    }
    if (source) {
      const parsedSource = MemorySourceSchema.safeParse(source);
      if (!parsedSource.success) {
        return reply.status(400).send({ error: "source must be a valid memory source" });
      }
    }

    const agentIds = agentId ? [agentId] : DEFAULT_AGENTS.map((agent) => agent.id);
    const allEntries = (
      await Promise.all(
        agentIds.map(async (currentAgentId) => {
          const entries = await memoryStore.listByAgent(currentAgentId);
          return entries.map((entry) => ({
            ...entry,
            agentId: currentAgentId,
          }));
        }),
      )
    )
      .flat()
      .sort((left, right) => right.createdAt - left.createdAt);

    const normalizedQuery = query?.toLowerCase();
    const filteredEntries = allEntries.filter((entry) => {
      if (category && entry.category !== category) return false;
      if (source && entry.source !== source) return false;
      if (!normalizedQuery) return true;

      const fields = [
        entry.content,
        entry.summary,
        entry.category,
        entry.source,
        ...entry.tags,
      ]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase());

      return fields.some((value) => value.includes(normalizedQuery));
    });

    return reply.send({
      entries: filteredEntries.slice(offset, offset + limit),
      total: filteredEntries.length,
      hasMore: offset + limit < filteredEntries.length,
      filters: {
        agentId: agentId ?? null,
        query: query ?? null,
        category: category ?? null,
        source: source ?? null,
      },
    });
  });

  app.post<{ Body: MemoryCreateBody }>("/api/memory", async (request, reply) => {
    const body = request.body;
    const parsed = CreateMemoryInputSchema.safeParse(body);

    if (!parsed.success || !body?.agentId) {
      return reply.status(400).send({
        error: "Invalid memory payload",
        details: parsed.success ? ["agentId is required"] : parsed.error.flatten(),
      });
    }

    const entry = await memoryStore.save({
      agentId: body.agentId,
      content: parsed.data.content,
      summary: parsed.data.summary,
      source: parsed.data.source,
      priority: parsed.data.priority,
      category: parsed.data.category,
      tags: parsed.data.tags,
      sessionId: parsed.data.sessionId,
      userId: parsed.data.userId,
      relatedMessageIds: parsed.data.relatedMessageIds,
      expiresAt: parsed.data.expiresAt,
    });

    return reply.status(201).send({ memory: entry });
  });

  app.post<{ Body: MemorySearchBody }>("/api/memory/search", async (request, reply) => {
    const body = request.body;
    if (!body?.agentId || !Array.isArray(body.embedding) || body.embedding.length === 0) {
      return reply.status(400).send({
        error: "agentId and a non-empty embedding array are required",
      });
    }

    const entries = await memoryStore.search({
      agentId: body.agentId,
      embedding: body.embedding,
      limit: body.limit,
      minRelevance: body.minRelevance,
      category: body.category,
      tags: body.tags,
      source: body.source,
    });

    return {
      entries,
      total: entries.length,
      hasMore: false,
    };
  });

  app.get<{ Params: { id: string } }>("/api/memory/:id", async (request, reply) => {
    const entry = await memoryStore.getById(request.params.id);
    if (!entry) {
      return reply.status(404).send({ error: "Memory not found" });
    }
    return { memory: entry };
  });

  app.delete<{ Params: { id: string } }>("/api/memory/:id", async (request, reply) => {
    const deleted = await memoryStore.delete(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: "Memory not found" });
    }
    return reply.status(204).send();
  });
}

function parsePositiveInt(value: string | number | undefined, fallback: number): number | null {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseNonNegativeInt(value: string | number | undefined, fallback: number): number | null {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

import type { FastifyInstance } from "fastify";
import {
  CreateMemoryInputSchema,
  type CreateMemoryInput,
} from "@karna/shared/types/memory.js";
import type { MemoryStore } from "@karna/agent/memory/store.js";

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

export function registerMemoryRoutes(app: FastifyInstance, memoryStore: MemoryStore): void {
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

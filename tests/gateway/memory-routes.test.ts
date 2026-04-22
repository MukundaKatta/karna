import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { MemoryStore, InMemoryBackend } from "../../agent/src/memory/store.js";
import { registerMemoryRoutes } from "../../gateway/src/routes/memory.js";

describe("memory routes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify();
    registerMemoryRoutes(app, new MemoryStore(new InMemoryBackend()));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("creates, retrieves, searches, and deletes memories", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/memory",
      payload: {
        agentId: "agent-1",
        content: "User prefers concise answers",
        source: "conversation",
        priority: "high",
        category: "preference",
        tags: ["preference"],
      },
    });

    expect(create.statusCode).toBe(201);
    const created = create.json().memory;
    expect(created.content).toContain("concise");

    const get = await app.inject({
      method: "GET",
      url: `/api/memory/${created.id}`,
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().memory.id).toBe(created.id);

    const list = await app.inject({
      method: "GET",
      url: "/api/memory?agentId=agent-1&query=concise",
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().entries).toHaveLength(1);
    expect(list.json().entries[0].agentId).toBe("agent-1");

    const search = await app.inject({
      method: "POST",
      url: "/api/memory/search",
      payload: {
        agentId: "agent-1",
        embedding: [0.2, 0.3, 0.4],
        limit: 5,
      },
    });
    expect(search.statusCode).toBe(200);
    expect(Array.isArray(search.json().entries)).toBe(true);

    const remove = await app.inject({
      method: "DELETE",
      url: `/api/memory/${created.id}`,
    });
    expect(remove.statusCode).toBe(204);

    const missing = await app.inject({
      method: "GET",
      url: `/api/memory/${created.id}`,
    });
    expect(missing.statusCode).toBe(404);
  });

  it("validates malformed create and search payloads", async () => {
    const badCreate = await app.inject({
      method: "POST",
      url: "/api/memory",
      payload: {
        content: "",
        source: "conversation",
      },
    });
    expect(badCreate.statusCode).toBe(400);

    const badSearch = await app.inject({
      method: "POST",
      url: "/api/memory/search",
      payload: {
        agentId: "agent-1",
        embedding: [],
      },
    });
    expect(badSearch.statusCode).toBe(400);

    const badList = await app.inject({
      method: "GET",
      url: "/api/memory?limit=0",
    });
    expect(badList.statusCode).toBe(400);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerOpenApiRoutes } from "../../gateway/src/routes/openapi.js";

describe("openapi routes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify();
    registerOpenApiRoutes(app);
    await app.ready();
  });

  it("serves the OpenAPI spec for real gateway routes", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/docs/openapi.json",
    });

    expect(response.statusCode).toBe(200);
    const spec = response.json();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec["x-websocket-protocol"].path).toBe("/ws");
    expect(spec["x-websocket-protocol"].serverMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "assistant.delta" }),
        expect.objectContaining({ type: "tool.approval.requested" }),
      ]),
    );
    expect(spec.paths["/api/agents"]).toBeDefined();
    expect(spec.paths["/api/skills"]).toBeDefined();
    expect(spec.paths["/api/skills/{id}"]).toBeDefined();
    expect(spec.paths["/api/tools"]).toBeDefined();
    expect(spec.paths["/api/workflows"]).toBeDefined();
    expect(spec.paths["/api/workflows/{workflowId}"]).toBeDefined();
    expect(spec.paths["/api/workflows/{workflowId}/run"]).toBeDefined();
    expect(spec.paths["/api/analytics/history"]).toBeDefined();
    expect(spec.paths["/api/runtime"]).toBeDefined();
    expect(spec.paths["/api/activity"]).toBeDefined();
    expect(spec.paths["/api/traces"]).toBeDefined();
    expect(spec.paths["/api/traces/stats"]).toBeDefined();
    expect(spec.paths["/api/message"]).toBeDefined();
    expect(spec.paths["/api/restart"]).toBeDefined();
    expect(spec.paths["/api/sessions/spawn"]).toBeDefined();
    expect(spec.paths["/api/sessions/{sessionId}/history"]).toBeDefined();
    expect(spec.paths["/api/sessions/{sessionId}/message"]).toBeDefined();
    expect(spec.paths["/api/access/policies/{channel}/pairings/approve"]).toBeDefined();
    expect(spec.paths["/api/memory"]).toBeDefined();
    expect(spec.paths["/api/memory/search"]).toBeDefined();
    expect(spec.paths["/docs/openapi.json"]).toBeDefined();
    expect(spec.paths["/docs"]).toBeDefined();
  });

  it("serves the Swagger UI shell", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/docs",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("SwaggerUIBundle");
    expect(response.body).toContain("/docs/openapi.json");
  });

  it("keeps legacy docs endpoints available", async () => {
    const specResponse = await app.inject({
      method: "GET",
      url: "/api/docs",
    });
    const uiResponse = await app.inject({
      method: "GET",
      url: "/api/docs/ui",
    });

    expect(specResponse.statusCode).toBe(200);
    expect(specResponse.json().openapi).toBe("3.1.0");
    expect(uiResponse.statusCode).toBe(200);
    expect(uiResponse.body).toContain("/docs/openapi.json");
  });
});

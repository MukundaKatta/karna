// ─── OpenAPI Specification ────────────────────────────────────────────────
//
// Auto-generates OpenAPI 3.1 spec for the Karna Gateway REST API.
// Serves at GET /api/docs (JSON) and GET /api/docs/ui (Swagger UI).
//
// ──────────────────────────────────────────────────────────────────────────

import type { FastifyInstance } from "fastify";

const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "Karna Gateway API",
    version: "0.1.0",
    description: "REST API for the Karna AI Agent Platform gateway. Provides session management, analytics, agent configuration, and observability.",
    contact: {
      name: "MukundaKatta",
      url: "https://github.com/MukundaKatta/karna",
    },
    license: {
      name: "MIT",
      url: "https://opensource.org/licenses/MIT",
    },
  },
  servers: [
    { url: "http://localhost:18789", description: "Local development" },
    { url: "https://karna-web.vercel.app", description: "Production" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Health check",
        description: "Returns system health status including memory, connections, and database status.",
        responses: {
          "200": {
            description: "System health information",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["healthy", "degraded", "unhealthy"] },
                    uptime: { type: "number" },
                    version: { type: "string" },
                    connections: { type: "number" },
                    sessions: { type: "number" },
                    memory: {
                      type: "object",
                      properties: {
                        heapUsed: { type: "number" },
                        heapTotal: { type: "number" },
                        rss: { type: "number" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/metrics": {
      get: {
        tags: ["Metrics"],
        summary: "Get metrics",
        description: "Returns JSON metrics for token usage, costs, latency, and throughput.",
        responses: { "200": { description: "JSON metrics" } },
      },
    },
    "/metrics/prometheus": {
      get: {
        tags: ["Metrics"],
        summary: "Prometheus metrics",
        description: "Returns metrics in Prometheus text format.",
        responses: { "200": { description: "Prometheus text metrics", content: { "text/plain": {} } } },
      },
    },
    "/api/sessions": {
      get: {
        tags: ["Sessions"],
        summary: "List sessions",
        description: "Returns all active and recent sessions with stats.",
        responses: { "200": { description: "Session list" } },
      },
    },
    "/api/analytics": {
      get: {
        tags: ["Analytics"],
        summary: "Get analytics overview",
        description: "Returns aggregated analytics: message counts, token usage, costs, channel breakdown.",
        responses: { "200": { description: "Analytics overview" } },
      },
    },
    "/api/analytics/history": {
      get: {
        tags: ["Analytics"],
        summary: "Get analytics history",
        description: "Returns time-series analytics data for charts.",
        parameters: [
          {
            name: "period",
            in: "query",
            schema: { type: "string", enum: ["7d", "14d", "30d"], default: "7d" },
            description: "Time period",
          },
        ],
        responses: { "200": { description: "Analytics history with daily data points" } },
      },
    },
    "/api/agents": {
      get: {
        tags: ["Agents"],
        summary: "List agents",
        description: "Returns all configured agent definitions.",
        responses: { "200": { description: "Agent list" } },
      },
    },
    "/api/agents/{id}": {
      get: {
        tags: ["Agents"],
        summary: "Get agent",
        description: "Returns a specific agent definition by ID.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Agent definition" },
          "404": { description: "Agent not found" },
        },
      },
    },
    "/api/activity": {
      get: {
        tags: ["Activity"],
        summary: "Get activity feed",
        description: "Returns recent activity events (sessions, tools, memory, skills).",
        responses: { "200": { description: "Activity feed" } },
      },
    },
    "/api/skills": {
      get: {
        tags: ["Skills"],
        summary: "List skills",
        description: "Returns all registered skills with their status.",
        responses: { "200": { description: "Skill list" } },
      },
    },
    "/api/tools": {
      get: {
        tags: ["Tools"],
        summary: "List tools",
        description: "Returns all registered tools with risk levels and usage stats.",
        responses: { "200": { description: "Tool list" } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
      apiKey: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
      },
    },
  },
  tags: [
    { name: "Health", description: "System health and status" },
    { name: "Metrics", description: "Performance metrics" },
    { name: "Sessions", description: "Conversation session management" },
    { name: "Analytics", description: "Usage analytics and cost tracking" },
    { name: "Agents", description: "AI agent configuration" },
    { name: "Activity", description: "Activity feed" },
    { name: "Skills", description: "Skill management" },
    { name: "Tools", description: "Tool permissions and audit" },
  ],
};

const SWAGGER_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Karna API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: '/api/docs', dom_id: '#swagger-ui', deepLinking: true });
  </script>
</body>
</html>`;

export function registerOpenApiRoutes(app: FastifyInstance): void {
  app.get("/api/docs", async (_, reply) => {
    reply.type("application/json").send(OPENAPI_SPEC);
  });

  app.get("/api/docs/ui", async (_, reply) => {
    reply.type("text/html").send(SWAGGER_HTML);
  });
}

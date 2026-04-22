import type { FastifyInstance } from "fastify";

const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "Karna Gateway API",
    version: "0.1.0",
    description:
      "REST API for the Karna AI Agent Platform gateway. Covers health, metrics, agent and skill catalogs, tool inventory, session operations, access control, memory, analytics, activity, traces, and API docs.",
  },
  servers: [
    { url: "http://localhost:18789", description: "Local development" },
  ],
  tags: [
    { name: "Health", description: "Gateway health and metrics" },
    { name: "Catalog", description: "Agent, skill, and tool inventory" },
    { name: "Sessions", description: "Live sessions, transcripts, and injected messages" },
    { name: "Access", description: "Channel access and pairing controls" },
    { name: "Memory", description: "Agent memory storage and retrieval" },
    { name: "Analytics", description: "Aggregated usage analytics" },
    { name: "Activity", description: "Audit-backed operator activity feed" },
    { name: "Traces", description: "Recent agent-turn traces, spans, and latency diagnostics" },
    { name: "Operations", description: "Live delivery and soft runtime control endpoints" },
    { name: "Docs", description: "OpenAPI specification and Swagger UI" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Health check",
        responses: {
          "200": { description: "Healthy or degraded gateway" },
          "503": { description: "Unhealthy gateway" },
        },
      },
    },
    "/metrics": {
      get: {
        tags: ["Health"],
        summary: "Metrics snapshot",
        responses: {
          "200": { description: "JSON metrics payload" },
        },
      },
    },
    "/metrics/prometheus": {
      get: {
        tags: ["Health"],
        summary: "Prometheus metrics",
        responses: {
          "200": { description: "Prometheus text exposition format" },
        },
      },
    },
    "/api/analytics": {
      get: {
        tags: ["Analytics"],
        summary: "Analytics overview",
        responses: {
          "200": { description: "Aggregated session and token analytics" },
        },
      },
    },
    "/api/analytics/history": {
      get: {
        tags: ["Analytics"],
        summary: "Daily analytics history",
        parameters: [
          queryParam("period", "string", "History window: 7d, 14d, or 30d"),
        ],
        responses: {
          "200": { description: "Daily message, token, cost, and error history" },
          "400": { description: "Invalid history period" },
        },
      },
    },
    "/api/agents": {
      get: {
        tags: ["Catalog"],
        summary: "List registered agents",
        responses: {
          "200": { description: "Agent catalog with live trace activity" },
        },
      },
    },
    "/api/agents/{id}": {
      get: {
        tags: ["Catalog"],
        summary: "Get a single agent",
        parameters: [pathParam("id", "Agent id")],
        responses: {
          "200": { description: "Agent detail" },
          "404": { description: "Agent not found" },
        },
      },
    },
    "/api/skills": {
      get: {
        tags: ["Catalog"],
        summary: "List installed and built-in skills",
        responses: {
          "200": { description: "Skill catalog" },
        },
      },
    },
    "/api/tools": {
      get: {
        tags: ["Catalog"],
        summary: "List built-in tools",
        responses: {
          "200": { description: "Tool catalog with trace-backed usage counts" },
        },
      },
    },
    "/api/activity": {
      get: {
        tags: ["Activity"],
        summary: "Activity feed",
        parameters: [
          queryParam("eventType", "string", "Filter by audit event type"),
          queryParam("actorId", "string", "Filter by actor id"),
          queryParam("sessionId", "string", "Filter by session id"),
          queryParam("since", "integer", "Only return events since this timestamp"),
          queryParam("limit", "integer", "Maximum number of events to return"),
        ],
        responses: {
          "200": { description: "Filtered activity events" },
          "400": { description: "Invalid activity filters" },
        },
      },
    },
    "/api/traces": {
      get: {
        tags: ["Traces"],
        summary: "List recent traces",
        parameters: [
          queryParam("sessionId", "string", "Filter by session id"),
          queryParam("agentId", "string", "Filter by agent id"),
          queryParam("limit", "integer", "Maximum number of traces to return"),
          queryParam("offset", "integer", "Offset into the trace list"),
          queryParam("since", "integer", "Only return traces since this timestamp"),
          queryParam("minDurationMs", "integer", "Only return traces at or above this duration"),
          queryParam("success", "boolean", "Filter completed traces by success value"),
          queryParam("includeActive", "boolean", "Include active in-flight traces"),
          queryParam("hasErrors", "boolean", "Only return traces with top-level or span errors"),
          queryParam("toolName", "string", "Filter traces that include a matching tool span"),
        ],
        responses: {
          "200": { description: "Filtered trace list" },
          "400": { description: "Invalid trace filters" },
        },
      },
    },
    "/api/traces/stats": {
      get: {
        tags: ["Traces"],
        summary: "Trace latency and reliability stats",
        parameters: [
          queryParam("periodMs", "integer", "Stats window in milliseconds"),
        ],
        responses: {
          "200": { description: "Trace stats payload" },
          "400": { description: "Invalid period" },
        },
      },
    },
    "/api/traces/{traceId}": {
      get: {
        tags: ["Traces"],
        summary: "Get a single trace",
        parameters: [pathParam("traceId", "Trace id")],
        responses: {
          "200": { description: "Trace detail" },
          "404": { description: "Trace not found" },
        },
      },
    },
    "/api/sessions": {
      get: {
        tags: ["Sessions"],
        summary: "List live sessions",
        parameters: sessionFilterParams(),
        responses: {
          "200": { description: "Matching live sessions" },
          "400": { description: "Invalid session filters" },
        },
      },
      delete: {
        tags: ["Sessions"],
        summary: "Bulk terminate sessions",
        parameters: [...sessionFilterParams(), queryParam("all", "boolean", "Terminate every live session")],
        responses: {
          "200": { description: "Bulk termination result" },
          "400": { description: "Unsafe or invalid bulk termination request" },
        },
      },
    },
    "/api/sessions/spawn": {
      post: {
        tags: ["Sessions"],
        summary: "Spawn an isolated session",
        responses: {
          "201": { description: "Spawned session with optional initial response" },
          "400": { description: "Invalid spawn payload" },
          "502": { description: "Spawned session failed to process its initial message" },
        },
      },
    },
    "/api/sessions/summary": {
      get: {
        tags: ["Sessions"],
        summary: "Summarize live sessions",
        parameters: sessionFilterParams(),
        responses: {
          "200": { description: "Live session summary" },
          "400": { description: "Invalid summary filters" },
        },
      },
    },
    "/api/sessions/{sessionId}": {
      get: {
        tags: ["Sessions"],
        summary: "Get a single session",
        parameters: [pathParam("sessionId", "Target session id")],
        responses: {
          "200": { description: "Session details" },
          "404": { description: "Session not found" },
        },
      },
      patch: {
        tags: ["Sessions"],
        summary: "Update session status",
        parameters: [pathParam("sessionId", "Target session id")],
        responses: {
          "200": { description: "Updated session" },
          "400": { description: "Invalid status update" },
          "404": { description: "Session not found" },
        },
      },
      delete: {
        tags: ["Sessions"],
        summary: "Terminate a session",
        parameters: [pathParam("sessionId", "Target session id")],
        responses: {
          "200": { description: "Termination result" },
          "404": { description: "Session not found" },
        },
      },
    },
    "/api/sessions/{sessionId}/history": {
      get: {
        tags: ["Sessions"],
        summary: "Read transcript history",
        parameters: [
          pathParam("sessionId", "Target session id"),
          queryParam("limit", "integer", "Maximum transcript messages to return"),
        ],
        responses: {
          "200": { description: "Transcript history" },
          "400": { description: "Invalid history query" },
          "404": { description: "Session transcript not found" },
        },
      },
      delete: {
        tags: ["Sessions"],
        summary: "Delete transcript history",
        parameters: [pathParam("sessionId", "Target session id")],
        responses: {
          "200": { description: "Transcript deletion result" },
        },
      },
    },
    "/api/sessions/{sessionId}/message": {
      post: {
        tags: ["Sessions"],
        summary: "Inject a message into a session",
        parameters: [pathParam("sessionId", "Target session id")],
        responses: {
          "200": { description: "Queued or immediate reply result" },
          "400": { description: "Invalid message payload" },
          "404": { description: "Session not found" },
          "502": { description: "Injected reply-back turn failed" },
        },
      },
    },
    "/api/message": {
      post: {
        tags: ["Operations"],
        summary: "Deliver an outbound message to a live session or channel",
        responses: {
          "200": { description: "Message persisted and optionally delivered to live clients" },
          "400": { description: "Invalid outbound message payload" },
          "404": { description: "Target session or channel not found" },
        },
      },
    },
    "/api/restart": {
      post: {
        tags: ["Operations"],
        summary: "Soft-restart the in-memory agent runtime",
        responses: {
          "200": { description: "Runtime restarted and pending approvals cleared" },
        },
      },
    },
    "/api/access/policies": {
      get: {
        tags: ["Access"],
        summary: "List access policies",
        responses: {
          "200": { description: "All channel access policies" },
        },
      },
    },
    "/api/access/policies/{channel}": {
      get: {
        tags: ["Access"],
        summary: "Get a channel access policy",
        parameters: [pathParam("channel", "Channel id/type")],
        responses: {
          "200": { description: "Channel access policy snapshot" },
        },
      },
      patch: {
        tags: ["Access"],
        summary: "Update a channel access policy",
        parameters: [pathParam("channel", "Channel id/type")],
        responses: {
          "200": { description: "Updated access policy snapshot" },
        },
      },
    },
    "/api/access/policies/{channel}/allowlist": {
      post: {
        tags: ["Access"],
        summary: "Add a user to the allowlist",
        parameters: [pathParam("channel", "Channel id/type")],
        responses: {
          "200": { description: "Updated access policy snapshot" },
          "400": { description: "Missing userId" },
        },
      },
    },
    "/api/access/policies/{channel}/allowlist/{userId}": {
      delete: {
        tags: ["Access"],
        summary: "Remove a user from the allowlist",
        parameters: [
          pathParam("channel", "Channel id/type"),
          pathParam("userId", "User id"),
        ],
        responses: {
          "200": { description: "Updated access policy snapshot" },
        },
      },
    },
    "/api/access/policies/{channel}/blocklist": {
      post: {
        tags: ["Access"],
        summary: "Add a user to the blocklist",
        parameters: [pathParam("channel", "Channel id/type")],
        responses: {
          "200": { description: "Updated access policy snapshot" },
          "400": { description: "Missing userId" },
        },
      },
    },
    "/api/access/policies/{channel}/blocklist/{userId}": {
      delete: {
        tags: ["Access"],
        summary: "Remove a user from the blocklist",
        parameters: [
          pathParam("channel", "Channel id/type"),
          pathParam("userId", "User id"),
        ],
        responses: {
          "200": { description: "Updated access policy snapshot" },
        },
      },
    },
    "/api/access/policies/{channel}/pairings/approve": {
      post: {
        tags: ["Access"],
        summary: "Approve a pairing code",
        parameters: [pathParam("channel", "Channel id/type")],
        responses: {
          "200": { description: "Pairing approval result" },
          "400": { description: "Missing code" },
          "404": { description: "Pairing code not found or expired" },
        },
      },
    },
    "/api/access/policies/{channel}/paired/{userId}": {
      delete: {
        tags: ["Access"],
        summary: "Revoke a paired user",
        parameters: [
          pathParam("channel", "Channel id/type"),
          pathParam("userId", "User id"),
        ],
        responses: {
          "200": { description: "Updated access policy snapshot" },
        },
      },
    },
    "/api/memory": {
      post: {
        tags: ["Memory"],
        summary: "Create a memory entry",
        responses: {
          "201": { description: "Created memory entry" },
          "400": { description: "Invalid memory payload" },
        },
      },
    },
    "/api/memory/search": {
      post: {
        tags: ["Memory"],
        summary: "Search memory entries",
        responses: {
          "200": { description: "Matching memory entries" },
          "400": { description: "Invalid memory search request" },
        },
      },
    },
    "/api/memory/{id}": {
      get: {
        tags: ["Memory"],
        summary: "Get a memory entry",
        parameters: [pathParam("id", "Memory id")],
        responses: {
          "200": { description: "Memory entry" },
          "404": { description: "Memory not found" },
        },
      },
      delete: {
        tags: ["Memory"],
        summary: "Delete a memory entry",
        parameters: [pathParam("id", "Memory id")],
        responses: {
          "204": { description: "Memory deleted" },
          "404": { description: "Memory not found" },
        },
      },
    },
    "/api/docs": {
      get: {
        tags: ["Docs"],
        summary: "OpenAPI specification",
        responses: {
          "200": { description: "OpenAPI JSON document" },
        },
      },
    },
    "/api/docs/ui": {
      get: {
        tags: ["Docs"],
        summary: "Swagger UI",
        responses: {
          "200": { description: "Swagger UI HTML" },
        },
      },
    },
  },
} as const;

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

function pathParam(name: string, description: string) {
  return {
    name,
    in: "path",
    required: true,
    description,
    schema: { type: "string" },
  };
}

function queryParam(name: string, type: "string" | "integer" | "boolean", description: string) {
  return {
    name,
    in: "query",
    required: false,
    description,
    schema: { type },
  };
}

function sessionFilterParams() {
  return [
    queryParam("channelType", "string", "Filter by channel type"),
    queryParam("channelId", "string", "Filter by channel id / agent id"),
    queryParam("userId", "string", "Filter by user id"),
    queryParam("status", "string", "Filter by session status"),
    queryParam("limit", "integer", "Maximum number of sessions to return"),
    queryParam("staleAfterMs", "integer", "Stale session threshold in milliseconds"),
  ];
}

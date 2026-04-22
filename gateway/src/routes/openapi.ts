import type { FastifyInstance } from "fastify";

const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "Karna Gateway API",
    version: "0.1.0",
    description:
      "REST API for the Karna AI Agent Platform gateway. Covers health, metrics, session operations, access control, memory, analytics, activity, and API docs.",
  },
  servers: [
    { url: "http://localhost:18789", description: "Local development" },
  ],
  tags: [
    { name: "Health", description: "Gateway health and metrics" },
    { name: "Sessions", description: "Live sessions, transcripts, and injected messages" },
    { name: "Access", description: "Channel access and pairing controls" },
    { name: "Memory", description: "Agent memory storage and retrieval" },
    { name: "Analytics", description: "Aggregated usage analytics" },
    { name: "Activity", description: "Audit-backed operator activity feed" },
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

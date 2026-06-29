/**
 * MCP server HTTP transport (Issue #544).
 *
 * Mounts the gateway's {@link McpServer} on a single JSON-RPC-over-HTTP
 * endpoint (POST /mcp). External MCP clients can `initialize`, `tools/list`,
 * and `tools/call` against karna's allowlisted built-in tools.
 *
 * Registered ONLY when `gateway.mcp.enabled` is true, so default startup is
 * unchanged. The body is the raw JSON-RPC payload (single request or batch);
 * the server returns the JSON-RPC response, or 204 for notification-only
 * payloads that produce no response.
 */
import type { FastifyInstance } from "fastify";
import type { McpServer } from "../mcp/server.js";

export function registerMcpRoutes(app: FastifyInstance, mcpServer: McpServer): void {
  // Accept the body as a raw string so handleRaw owns parsing/JSON-RPC errors.
  app.post("/mcp", async (request, reply) => {
    const raw =
      typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
    const responseJson = await mcpServer.handleRaw(raw);
    if (responseJson === undefined) {
      // Notification(s) only — no JSON-RPC response per spec.
      return reply.status(204).send();
    }
    return reply.header("content-type", "application/json").send(responseJson);
  });

  // Lightweight liveness probe for MCP clients / dashboards.
  app.get("/mcp", async (_request, reply) => {
    return reply.send({ server: "karna-gateway", transport: "http", enabled: mcpServer.enabled });
  });
}

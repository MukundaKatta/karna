// ─── MCP Server Initialization ──────────────────────────────────────────────
//
// Creates and registers the MCP server with the Karna gateway.
// Supports both stdio and SSE transports.
//
// ─────────────────────────────────────────────────────────────────────────────

import type { FastifyInstance } from "fastify";
import pino from "pino";
import {
  KarnaMCPServer,
  type MCPServerConfig,
  type MCPToolDefinition,
  type ToolExecutor,
  type ToolLister,
  type MCPResource,
  type ResourceLister,
  type ResourceReader,
} from "./server.js";

export {
  KarnaMCPServer,
  type MCPServerConfig,
  type MCPToolDefinition,
  type ToolExecutor,
  type ToolLister,
  type MCPResource,
  type ResourceLister,
  type ResourceReader,
} from "./server.js";

const logger = pino({ name: "mcp-init" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MCPRegistrationConfig {
  /** Whether to enable the MCP server. */
  enabled?: boolean;
  /** Transport type: stdio runs standalone, sse runs inside the gateway. */
  transport?: "stdio" | "sse";
  /** SSE endpoint path (only for sse transport). */
  ssePath?: string;
  /** Server name. */
  name?: string;
  /** Server version. */
  version?: string;
  /** Function that returns the list of available tools. */
  listTools: ToolLister;
  /** Function that executes a tool by name. */
  executeTool: ToolExecutor;
  /** Optional function that returns available resources. */
  listResources?: ResourceLister;
  /** Optional function that reads a resource. */
  readResource?: ResourceReader;
}

// ─── Registration ───────────────────────────────────────────────────────────

/**
 * Create and optionally register the MCP server with a Fastify instance.
 *
 * For stdio transport, the server runs standalone (used when Karna
 * is invoked as an MCP server by another AI agent).
 *
 * For SSE transport, the server registers HTTP endpoints on the
 * Fastify instance alongside the main gateway.
 */
export async function registerMCPServer(
  fastify: FastifyInstance | null,
  config: MCPRegistrationConfig,
): Promise<KarnaMCPServer | null> {
  if (config.enabled === false) {
    logger.info("MCP server is disabled");
    return null;
  }

  const transport = config.transport ?? "sse";

  const mcpServer = new KarnaMCPServer({
    name: config.name ?? "karna-mcp",
    version: config.version ?? "0.1.0",
    transport,
    listTools: config.listTools,
    executeTool: config.executeTool,
    listResources: config.listResources,
    readResource: config.readResource,
  });

  if (transport === "stdio") {
    await mcpServer.start();
    logger.info("MCP server started with stdio transport");
    return mcpServer;
  }

  // SSE transport: register endpoints on Fastify
  if (!fastify) {
    throw new Error("Fastify instance is required for SSE transport");
  }

  const ssePath = config.ssePath ?? "/mcp";

  // SSE endpoint for MCP clients to connect
  fastify.get(`${ssePath}/sse`, async (request, reply) => {
    logger.info(
      { remoteAddress: request.ip },
      "MCP SSE client connected",
    );

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Send the message endpoint URL to the client
    const messageUrl = `${ssePath}/message`;
    reply.raw.write(`data: ${JSON.stringify({ endpoint: messageUrl })}\n\n`);

    // Keep connection alive
    const keepAlive = setInterval(() => {
      reply.raw.write(": keepalive\n\n");
    }, 15_000);

    request.raw.on("close", () => {
      clearInterval(keepAlive);
      logger.info("MCP SSE client disconnected");
    });
  });

  // Message endpoint for MCP JSON-RPC messages
  fastify.post(`${ssePath}/message`, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const method = body["method"] as string | undefined;

    logger.debug({ method }, "MCP message received");

    // Route through the MCP server's handler
    try {
      const server = mcpServer.getServer();

      // For tool listing
      if (method === "tools/list") {
        const tools = config.listTools();
        await reply.send({
          jsonrpc: "2.0",
          id: body["id"],
          result: {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: {
                type: "object",
                properties: t.parameters.properties,
                required: t.parameters.required,
              },
            })),
          },
        });
        return;
      }

      // For tool calling
      if (method === "tools/call") {
        const params = body["params"] as Record<string, unknown> | undefined;
        const toolName = params?.["name"] as string;
        const toolArgs = (params?.["arguments"] ?? {}) as Record<string, unknown>;

        const result = await config.executeTool(toolName, toolArgs);

        const outputText = typeof result.output === "string"
          ? result.output
          : JSON.stringify(result.output, null, 2);

        await reply.send({
          jsonrpc: "2.0",
          id: body["id"],
          result: {
            content: [{ type: "text", text: result.isError ? `Error: ${result.errorMessage}` : outputText }],
            isError: result.isError,
          },
        });
        return;
      }

      // For resource listing
      if (method === "resources/list" && config.listResources) {
        const resources = config.listResources();
        await reply.send({
          jsonrpc: "2.0",
          id: body["id"],
          result: {
            resources: resources.map((r) => ({
              uri: r.uri,
              name: r.name,
              description: r.description,
              mimeType: r.mimeType,
            })),
          },
        });
        return;
      }

      // For resource reading
      if (method === "resources/read" && config.readResource) {
        const params = body["params"] as Record<string, unknown> | undefined;
        const uri = params?.["uri"] as string;
        const { content, mimeType } = await config.readResource(uri);

        await reply.send({
          jsonrpc: "2.0",
          id: body["id"],
          result: {
            contents: [{ uri, text: content, mimeType }],
          },
        });
        return;
      }

      // Initialize/ping/other standard MCP methods
      if (method === "initialize") {
        await reply.send({
          jsonrpc: "2.0",
          id: body["id"],
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: {
              name: config.name ?? "karna-mcp",
              version: config.version ?? "0.1.0",
            },
            capabilities: {
              tools: {},
              resources: config.listResources ? {} : undefined,
            },
          },
        });
        return;
      }

      if (method === "ping") {
        await reply.send({
          jsonrpc: "2.0",
          id: body["id"],
          result: {},
        });
        return;
      }

      // Unknown method
      await reply.status(400).send({
        jsonrpc: "2.0",
        id: body["id"],
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ method, error: errorMessage }, "MCP message handling error");

      await reply.status(500).send({
        jsonrpc: "2.0",
        id: body["id"],
        error: {
          code: -32603,
          message: errorMessage,
        },
      });
    }
  });

  logger.info(
    { ssePath, sseEndpoint: `${ssePath}/sse`, messageEndpoint: `${ssePath}/message` },
    "MCP server registered with SSE transport",
  );

  return mcpServer;
}

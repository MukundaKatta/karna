// ─── MCP Server ─────────────────────────────────────────────────────────────
//
// Model Context Protocol server that exposes Karna's registered tools
// to external AI agents. Uses the @modelcontextprotocol/sdk.
//
// ─────────────────────────────────────────────────────────────────────────────

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import pino from "pino";

const logger = pino({ name: "mcp-server" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MCPToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
}

/**
 * Callback to execute a tool via the Karna agent runtime.
 */
export type ToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<{ output: unknown; isError: boolean; errorMessage?: string }>;

/**
 * Callback to list available tools from the Karna registry.
 */
export type ToolLister = () => MCPToolDefinition[];

/**
 * Callback to list available resources.
 */
export type ResourceLister = () => MCPResource[];

/**
 * Callback to read a resource by URI.
 */
export type ResourceReader = (uri: string) => Promise<{ content: string; mimeType: string }>;

export interface MCPServerConfig {
  /** Server name for MCP identification. */
  name?: string;
  /** Server version. */
  version?: string;
  /** Transport type. */
  transport?: "stdio" | "sse";
  /** Callback to list tools. */
  listTools: ToolLister;
  /** Callback to execute a tool. */
  executeTool: ToolExecutor;
  /** Callback to list resources (optional). */
  listResources?: ResourceLister;
  /** Callback to read a resource (optional). */
  readResource?: ResourceReader;
}

// ─── MCP Server ─────────────────────────────────────────────────────────────

export class KarnaMCPServer {
  private readonly server: Server;
  private readonly config: MCPServerConfig;
  private running = false;

  constructor(config: MCPServerConfig) {
    this.config = config;

    this.server = new Server(
      {
        name: config.name ?? "karna-mcp",
        version: config.version ?? "0.1.0",
      },
      {
        capabilities: {
          tools: {},
          resources: config.listResources ? {} : undefined,
        },
      },
    );

    this.registerHandlers();
    this.registerErrorHandler();

    logger.info(
      { name: config.name ?? "karna-mcp", version: config.version ?? "0.1.0" },
      "MCP server created",
    );
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Start the MCP server with the configured transport.
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn("MCP server is already running");
      return;
    }

    const transportType = this.config.transport ?? "stdio";

    if (transportType === "stdio") {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      logger.info("MCP server started with stdio transport");
    } else {
      // SSE transport requires Fastify integration — handled in index.ts
      logger.info("MCP server created for SSE transport (register with Fastify)");
    }

    this.running = true;
  }

  /**
   * Stop the MCP server.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    try {
      await this.server.close();
      this.running = false;
      logger.info("MCP server stopped");
    } catch (error) {
      logger.error({ error }, "Error stopping MCP server");
    }
  }

  /**
   * Get the underlying MCP Server instance (for SSE transport integration).
   */
  getServer(): Server {
    return this.server;
  }

  // ─── SSE Transport ────────────────────────────────────────────────────

  /**
   * Create an SSE transport for a Fastify request/response pair.
   * This is used when the MCP server runs alongside the gateway on
   * a dedicated HTTP endpoint.
   */
  async createSSETransport(
    endpoint: string,
  ): Promise<SSEServerTransport> {
    const transport = new SSEServerTransport(endpoint, {} as never);
    return transport;
  }

  // ─── Handler Registration ─────────────────────────────────────────────

  private registerHandlers(): void {
    this.registerToolHandlers();
    if (this.config.listResources) {
      this.registerResourceHandlers();
    }
  }

  private registerToolHandlers(): void {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.config.listTools();

      logger.debug({ toolCount: tools.length }, "Listing MCP tools");

      return {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: {
            type: "object" as const,
            properties: tool.parameters.properties,
            required: tool.parameters.required,
          },
        })),
      };
    });

    // Call tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      logger.info({ toolName: name }, "MCP tool invocation");

      try {
        const result = await this.config.executeTool(
          name,
          (args ?? {}) as Record<string, unknown>,
        );

        if (result.isError) {
          logger.warn(
            { toolName: name, error: result.errorMessage },
            "MCP tool execution failed",
          );

          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${result.errorMessage ?? "Unknown error"}`,
              },
            ],
            isError: true,
          };
        }

        const outputText = typeof result.output === "string"
          ? result.output
          : JSON.stringify(result.output, null, 2);

        logger.info(
          { toolName: name, outputLength: outputText.length },
          "MCP tool execution succeeded",
        );

        return {
          content: [
            {
              type: "text" as const,
              text: outputText,
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ toolName: name, error: errorMessage }, "MCP tool invocation error");

        return {
          content: [
            {
              type: "text" as const,
              text: `Error invoking tool "${name}": ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private registerResourceHandlers(): void {
    // List resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = this.config.listResources?.() ?? [];

      logger.debug({ resourceCount: resources.length }, "Listing MCP resources");

      return {
        resources: resources.map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        })),
      };
    });

    // Read resource
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      if (!this.config.readResource) {
        return {
          contents: [
            {
              uri,
              text: "Resource reading not supported",
              mimeType: "text/plain",
            },
          ],
        };
      }

      try {
        const { content, mimeType } = await this.config.readResource(uri);

        return {
          contents: [
            {
              uri,
              text: content,
              mimeType,
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ uri, error: errorMessage }, "Resource read error");

        return {
          contents: [
            {
              uri,
              text: `Error reading resource: ${errorMessage}`,
              mimeType: "text/plain",
            },
          ],
        };
      }
    });
  }

  private registerErrorHandler(): void {
    this.server.onerror = (error) => {
      logger.error({ error }, "MCP server error");
    };
  }
}

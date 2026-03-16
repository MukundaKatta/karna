// ─── MCP Client Tool ──────────────────────────────────────────────────────

import { z } from "zod";
import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../registry.js";

const logger = pino({ name: "tool-mcp-client" });

const CONNECTION_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 30_000;

// ─── Connection Pool ─────────────────────────────────────────────────────

interface McpConnection {
  id: string;
  url: string;
  client: any;
  transport: any;
  connectedAt: string;
  tools: Array<{ name: string; description?: string }>;
}

const connections = new Map<string, McpConnection>();
let connectionCounter = 0;

async function getMcpSdk() {
  try {
    const sdk = await import("@modelcontextprotocol/sdk/client/index.js");
    return sdk;
  } catch {
    throw new Error(
      "@modelcontextprotocol/sdk is not installed. Run: npm install @modelcontextprotocol/sdk"
    );
  }
}

async function getMcpTransport() {
  try {
    const transport = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    return transport;
  } catch {
    // Fall back to SSE transport
    const transport = await import("@modelcontextprotocol/sdk/client/sse.js");
    return transport;
  }
}

// ─── List Servers ────────────────────────────────────────────────────────

const ListServersInputSchema = z.object({});

export const mcpListServersTool: ToolDefinitionRuntime = {
  name: "mcp_list_servers",
  description: "List all currently connected MCP servers and their status.",
  parameters: {
    type: "object",
    properties: {},
  },
  inputSchema: ListServersInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 5_000,
  tags: ["mcp", "list"],

  async execute(
    _input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const servers = Array.from(connections.values()).map((conn) => ({
      id: conn.id,
      url: conn.url,
      connectedAt: conn.connectedAt,
      toolCount: conn.tools.length,
    }));

    return { servers, totalServers: servers.length };
  },
};

// ─── Connect Server ──────────────────────────────────────────────────────

const ConnectServerInputSchema = z.object({
  url: z.string().url().describe("URL of the MCP server to connect to"),
  name: z.string().optional().describe("Optional friendly name for the server"),
});

export const mcpConnectServerTool: ToolDefinitionRuntime = {
  name: "mcp_connect_server",
  description:
    "Connect to an MCP (Model Context Protocol) server. " +
    "Discovers available tools on the server and stores the connection.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL of the MCP server to connect to" },
      name: { type: "string", description: "Optional friendly name for the server" },
    },
    required: ["url"],
  },
  inputSchema: ConnectServerInputSchema,
  riskLevel: "medium",
  requiresApproval: true,
  timeout: CONNECTION_TIMEOUT_MS + 5_000,
  tags: ["mcp", "connect"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = ConnectServerInputSchema.parse(input);

    // Check if already connected to this URL
    for (const conn of connections.values()) {
      if (conn.url === parsed.url) {
        return {
          alreadyConnected: true,
          id: conn.id,
          url: conn.url,
          toolCount: conn.tools.length,
        };
      }
    }

    const sdk = await getMcpSdk();
    const transportModule = await getMcpTransport();

    logger.info({ url: parsed.url }, "Connecting to MCP server");

    const serverId = parsed.name ?? `mcp_${++connectionCounter}`;

    const client = new sdk.Client({
      name: "karna-agent",
      version: "1.0.0",
    });

    // Determine transport based on what's available
    let transport: any;
    if ("StreamableHTTPClientTransport" in transportModule) {
      transport = new transportModule.StreamableHTTPClientTransport(new URL(parsed.url));
    } else if ("SSEClientTransport" in transportModule) {
      transport = new transportModule.SSEClientTransport(new URL(parsed.url));
    } else {
      throw new Error("No suitable MCP transport available");
    }

    await client.connect(transport);

    // List available tools
    const toolsResult = await client.listTools();
    const tools = (toolsResult.tools ?? []).map((t: any) => ({
      name: t.name,
      description: t.description,
    }));

    const connection: McpConnection = {
      id: serverId,
      url: parsed.url,
      client,
      transport,
      connectedAt: new Date().toISOString(),
      tools,
    };

    connections.set(serverId, connection);

    logger.info({ serverId, toolCount: tools.length }, "Connected to MCP server");

    return {
      connected: true,
      id: serverId,
      url: parsed.url,
      tools,
      toolCount: tools.length,
    };
  },
};

// ─── List Tools ──────────────────────────────────────────────────────────

const McpListToolsInputSchema = z.object({
  serverId: z.string().min(1).describe("Server ID (from mcp_connect_server)"),
});

export const mcpListToolsTool: ToolDefinitionRuntime = {
  name: "mcp_list_tools",
  description: "List available tools on a connected MCP server.",
  parameters: {
    type: "object",
    properties: {
      serverId: { type: "string", description: "Server ID (from mcp_connect_server)" },
    },
    required: ["serverId"],
  },
  inputSchema: McpListToolsInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 10_000,
  tags: ["mcp", "tools", "list"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = McpListToolsInputSchema.parse(input);

    const conn = connections.get(parsed.serverId);
    if (!conn) {
      throw new Error(`Server not connected: ${parsed.serverId}. Use mcp_connect_server first.`);
    }

    // Refresh tool list
    const toolsResult = await conn.client.listTools();
    const tools = (toolsResult.tools ?? []).map((t: any) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    conn.tools = tools;

    return { serverId: parsed.serverId, tools, toolCount: tools.length };
  },
};

// ─── Call Tool ───────────────────────────────────────────────────────────

const McpCallToolInputSchema = z.object({
  serverId: z.string().min(1).describe("Server ID (from mcp_connect_server)"),
  toolName: z.string().min(1).describe("Name of the tool to call on the MCP server"),
  args: z
    .record(z.unknown())
    .optional()
    .default({})
    .describe("Arguments to pass to the tool"),
});

export const mcpCallToolTool: ToolDefinitionRuntime = {
  name: "mcp_call_tool",
  description:
    "Call a tool on a connected MCP server with the specified arguments. " +
    "Returns the tool's response.",
  parameters: {
    type: "object",
    properties: {
      serverId: { type: "string", description: "Server ID (from mcp_connect_server)" },
      toolName: { type: "string", description: "Name of the tool to call" },
      args: {
        type: "object",
        description: "Arguments to pass to the tool",
      },
    },
    required: ["serverId", "toolName"],
  },
  inputSchema: McpCallToolInputSchema,
  riskLevel: "medium",
  requiresApproval: true,
  timeout: CALL_TIMEOUT_MS + 5_000,
  tags: ["mcp", "tools", "call"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = McpCallToolInputSchema.parse(input);

    const conn = connections.get(parsed.serverId);
    if (!conn) {
      throw new Error(`Server not connected: ${parsed.serverId}. Use mcp_connect_server first.`);
    }

    logger.info(
      { serverId: parsed.serverId, toolName: parsed.toolName },
      "Calling MCP tool"
    );

    const result = await conn.client.callTool({
      name: parsed.toolName,
      arguments: parsed.args,
    });

    return {
      serverId: parsed.serverId,
      toolName: parsed.toolName,
      result: result.content,
      isError: result.isError ?? false,
    };
  },
};

// ─── Disconnect Server ───────────────────────────────────────────────────

const McpDisconnectInputSchema = z.object({
  serverId: z.string().min(1).describe("Server ID to disconnect"),
});

export const mcpDisconnectServerTool: ToolDefinitionRuntime = {
  name: "mcp_disconnect_server",
  description: "Disconnect from an MCP server and clean up resources.",
  parameters: {
    type: "object",
    properties: {
      serverId: { type: "string", description: "Server ID to disconnect" },
    },
    required: ["serverId"],
  },
  inputSchema: McpDisconnectInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 10_000,
  tags: ["mcp", "disconnect"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = McpDisconnectInputSchema.parse(input);

    const conn = connections.get(parsed.serverId);
    if (!conn) {
      throw new Error(`Server not connected: ${parsed.serverId}`);
    }

    logger.info({ serverId: parsed.serverId }, "Disconnecting MCP server");

    try {
      await conn.client.close();
    } catch (err) {
      logger.warn({ err, serverId: parsed.serverId }, "Error closing MCP client");
    }

    try {
      await conn.transport.close();
    } catch (err) {
      logger.warn({ err, serverId: parsed.serverId }, "Error closing MCP transport");
    }

    connections.delete(parsed.serverId);

    return { disconnected: true, serverId: parsed.serverId };
  },
};

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

// ─── Transport-agnostic client core (#543, #546) ───────────────────────────
//
// ADDITIVE: the tool objects above keep using the optional SDK transport. The
// types/class below provide a pure, SDK-free MCP JSON-RPC client over an
// injectable transport so the protocol logic is unit-testable with a mock
// transport (no network/process/SDK). Nothing above is modified.

/** Client-side JSON-RPC request shape (notifications omit `id`). */
export interface AgentJsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

/** Client-side JSON-RPC response shape. */
export interface AgentJsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Injectable bidirectional MCP transport. `send` correlates a request with its
 * response by `id`; notifications resolve `undefined`.
 */
export interface McpTransport {
  send(request: AgentJsonRpcRequest): Promise<AgentJsonRpcResponse | undefined>;
  onNotification?(handler: (notification: AgentJsonRpcRequest) => void): void;
  close?(): Promise<void> | void;
}

export interface AgentMcpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface AgentMcpContentBlock {
  type: string;
  text?: string;
  [k: string]: unknown;
}

export interface AgentMcpCallToolResult {
  content: AgentMcpContentBlock[];
  isError: boolean;
}

export class AgentMcpRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "AgentMcpRpcError";
  }
}

/**
 * Pure MCP client over an {@link McpTransport}. Supports initialize, listTools,
 * callTool, listResources/readResource, and getPrompt — all SDK-free.
 */
export class AgentMcpClient {
  private readonly transport: McpTransport;
  private nextId = 1;
  private initialized = false;

  constructor(transport: McpTransport) {
    this.transport = transport;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  async initialize(): Promise<unknown> {
    const result = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "karna-agent", version: "1.0.0" },
    });
    this.initialized = true;
    await this.notify("notifications/initialized", {});
    return result;
  }

  async listTools(): Promise<AgentMcpToolInfo[]> {
    const result = (await this.request("tools/list", {})) as {
      tools?: AgentMcpToolInfo[];
    };
    return result.tools ?? [];
  }

  async callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<AgentMcpCallToolResult> {
    const result = (await this.request("tools/call", {
      name,
      arguments: args,
    })) as { content?: AgentMcpContentBlock[]; isError?: boolean };
    return { content: result.content ?? [], isError: result.isError ?? false };
  }

  async listResources(): Promise<
    Array<{ uri: string; name?: string; mimeType?: string }>
  > {
    const result = (await this.request("resources/list", {})) as {
      resources?: Array<{ uri: string; name?: string; mimeType?: string }>;
    };
    return result.resources ?? [];
  }

  async readResource(
    uri: string,
  ): Promise<Array<{ uri: string; text?: string; blob?: string; mimeType?: string }>> {
    const result = (await this.request("resources/read", { uri })) as {
      contents?: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }>;
    };
    return result.contents ?? [];
  }

  async getPrompt(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<{ description?: string; messages: Array<{ role: string; content: AgentMcpContentBlock }> }> {
    const result = (await this.request("prompts/get", {
      name,
      arguments: args,
    })) as {
      description?: string;
      messages?: Array<{ role: string; content: AgentMcpContentBlock }>;
    };
    return { description: result.description, messages: result.messages ?? [] };
  }

  async close(): Promise<void> {
    this.initialized = false;
    await this.transport.close?.();
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const res = await this.transport.send({ jsonrpc: "2.0", id, method, params });
    if (!res) {
      throw new AgentMcpRpcError(-32603, `no response for method "${method}"`);
    }
    if (res.error) {
      throw new AgentMcpRpcError(res.error.code, res.error.message, res.error.data);
    }
    return res.result;
  }

  private async notify(method: string, params: unknown): Promise<void> {
    await this.transport.send({ jsonrpc: "2.0", method, params });
  }
}

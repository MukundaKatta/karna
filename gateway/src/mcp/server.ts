/**
 * Gateway MCP server (#544).
 *
 * Exposes selected karna tools as MCP tools over the JSON-RPC protocol
 * (tools/list + tools/call), respecting an allowlist. This is transport-
 * agnostic: it consumes parsed JSON-RPC request objects and returns JSON-RPC
 * responses, so it can be mounted on any transport (HTTP route, stdio, WS)
 * without changing the gateway's default startup behavior.
 *
 * It is OFF by default (`enabled: false`) and only exposes tools named in the
 * allowlist.
 */
import { z } from 'zod';
import type { Logger } from 'pino';

export const McpExposeConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Only these tool names are exposed. Empty allowlist => nothing exposed. */
  allowlist: z.array(z.string()).default([]),
  /** Server identity advertised in the `initialize` handshake. */
  serverName: z.string().default('karna-gateway'),
  serverVersion: z.string().default('1.0.0'),
});

export type McpExposeConfig = z.infer<typeof McpExposeConfigSchema>;

// ---------------------------------------------------------------------------
// JSON-RPC shapes
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export const JsonRpcErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

// ---------------------------------------------------------------------------
// Tool source abstraction
// ---------------------------------------------------------------------------

/** Shape of a tool the server can expose. Matches the agent ToolDefinition. */
export interface ExposableTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown) => Promise<unknown>;
  available?: boolean;
}

/** Minimal provider interface (satisfied by the agent's ToolRegistry). */
export interface ToolProvider {
  list(): ExposableTool[];
  get(name: string): ExposableTool | undefined;
}

export interface McpServerOptions {
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export class McpServer {
  private readonly config: McpExposeConfig;
  private readonly provider: ToolProvider;
  private readonly logger?: Logger;
  private readonly allowSet: Set<string>;

  constructor(
    provider: ToolProvider,
    config: Partial<McpExposeConfig> = {},
    options: McpServerOptions = {},
  ) {
    this.provider = provider;
    this.config = McpExposeConfigSchema.parse(config);
    this.logger = options.logger;
    this.allowSet = new Set(this.config.allowlist);
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  /** Tools currently exposed (allowlisted + available). */
  exposedTools(): ExposableTool[] {
    if (!this.config.enabled) return [];
    return this.provider
      .list()
      .filter((t) => this.allowSet.has(t.name) && t.available !== false);
  }

  /**
   * Handle a single JSON-RPC request and produce a response. Returns
   * `undefined` for notifications (requests without an id), per JSON-RPC.
   */
  async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
    const isNotification = req.id === undefined || req.id === null;
    const id = (req.id ?? null) as number | string | null;

    if (!this.config.enabled) {
      if (isNotification) return undefined;
      return this.error(id, JsonRpcErrorCodes.InvalidRequest, 'mcp server disabled');
    }

    if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      return this.error(id, JsonRpcErrorCodes.InvalidRequest, 'invalid request');
    }

    try {
      switch (req.method) {
        case 'initialize':
          return this.ok(id, this.initializeResult());
        case 'notifications/initialized':
        case 'initialized':
          return undefined; // notification — no response
        case 'ping':
          return this.ok(id, {});
        case 'tools/list':
          return this.ok(id, { tools: this.toolList() });
        case 'tools/call':
          return this.ok(id, await this.callTool(req.params));
        default:
          if (isNotification) return undefined;
          return this.error(
            id,
            JsonRpcErrorCodes.MethodNotFound,
            `method not found: ${req.method}`,
          );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn({ err, method: req.method }, 'mcp server request failed');
      if (isNotification) return undefined;
      const code =
        err instanceof RpcError ? err.code : JsonRpcErrorCodes.InternalError;
      return this.error(id, code, message);
    }
  }

  /** Handle a raw JSON string (or batch). Convenience for HTTP/stdio mounts. */
  async handleRaw(raw: string): Promise<string | undefined> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return JSON.stringify(
        this.error(null, JsonRpcErrorCodes.ParseError, 'parse error'),
      );
    }
    if (Array.isArray(parsed)) {
      const responses = (
        await Promise.all(parsed.map((r) => this.handleRequest(r as JsonRpcRequest)))
      ).filter((r): r is JsonRpcResponse => r !== undefined);
      return responses.length > 0 ? JSON.stringify(responses) : undefined;
    }
    const res = await this.handleRequest(parsed as JsonRpcRequest);
    return res ? JSON.stringify(res) : undefined;
  }

  // -------------------------------------------------------------------------

  private initializeResult() {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: {
        name: this.config.serverName,
        version: this.config.serverVersion,
      },
    };
  }

  private toolList() {
    return this.exposedTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  private async callTool(params: unknown): Promise<unknown> {
    const parsed = z
      .object({ name: z.string(), arguments: z.record(z.unknown()).optional() })
      .safeParse(params);
    if (!parsed.success) {
      throw new RpcError(
        JsonRpcErrorCodes.InvalidParams,
        'invalid tools/call params',
      );
    }
    const { name, arguments: args } = parsed.data;
    if (!this.allowSet.has(name)) {
      throw new RpcError(JsonRpcErrorCodes.InvalidParams, `tool not exposed: ${name}`);
    }
    const tool = this.provider.get(name);
    if (!tool || tool.available === false) {
      throw new RpcError(JsonRpcErrorCodes.InvalidParams, `tool unavailable: ${name}`);
    }
    try {
      const result = await tool.execute(args ?? {});
      return {
        content: [{ type: 'text', text: stringifyResult(result) }],
        isError: false,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: message }],
        isError: true,
      };
    }
  }

  private ok(id: number | string | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result };
  }

  private error(
    id: number | string | null,
    code: number,
    message: string,
    data?: unknown,
  ): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message, data } };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

function stringifyResult(result: unknown): string {
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

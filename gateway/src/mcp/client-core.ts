/**
 * Transport-agnostic MCP client core (#543, #546).
 *
 * A pure MCP JSON-RPC *client* that speaks the protocol over an injectable
 * {@link McpTransport}. This contains zero network/process/SDK code: callers
 * provide a transport (HTTP, stdio, WebSocket, or — in tests — an in-memory
 * mock). Because of this, the whole client is unit-testable without the
 * optional `@modelcontextprotocol/sdk` dependency or any real I/O.
 *
 * Implements the client side of:
 *  - `initialize` handshake
 *  - `tools/list` + `tools/call`        (#543)
 *  - `resources/list` + `resources/read` (#546 — resources)
 *  - `prompts/list` + `prompts/get`      (#546 — prompts)
 *
 * It also surfaces server `notifications/tools/list_changed` events so a higher
 * layer (the registry bridge, #545) can re-discover tools.
 */
import type { Logger } from 'pino';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
} from './server.js';

// ---------------------------------------------------------------------------
// Transport abstraction
// ---------------------------------------------------------------------------

/**
 * A bidirectional MCP transport. `send` issues a JSON-RPC request and resolves
 * with the matching response. Notifications (requests without an `id`) are
 * fire-and-forget and resolve with `undefined`.
 *
 * Implementations are responsible for request/response correlation by `id`.
 */
export interface McpTransport {
  /** Send a request and await its response. Notifications resolve undefined. */
  send(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined>;
  /**
   * Register a handler for server-initiated notifications (no id). Optional —
   * transports that cannot receive server pushes may omit it.
   */
  onNotification?(handler: (notification: JsonRpcRequest) => void): void;
  /** Close the transport and release resources. Optional. */
  close?(): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// MCP wire shapes (client view)
// ---------------------------------------------------------------------------

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpContentBlock {
  type: string;
  text?: string;
  [k: string]: unknown;
}

export interface McpCallToolResult {
  content: McpContentBlock[];
  isError: boolean;
}

export interface McpResourceInfo {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceContents {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

/** Normalised "context attachment" derived from a resource read (#546). */
export interface ResourceAttachment {
  uri: string;
  mimeType?: string;
  /** Concatenated text contents, when the resource is textual. */
  text: string;
  /** Whether any part of the resource was binary (blob) and thus omitted. */
  hasBinary: boolean;
}

export interface McpPromptArgumentInfo {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptInfo {
  name: string;
  description?: string;
  arguments?: McpPromptArgumentInfo[];
}

export interface McpPromptMessage {
  role: string;
  content: McpContentBlock;
}

export interface McpGetPromptResult {
  description?: string;
  messages: McpPromptMessage[];
}

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: McpServerInfo;
}

export interface McpClientOptions {
  /** Client identity advertised in `initialize`. */
  clientName?: string;
  clientVersion?: string;
  /** Protocol version to request. */
  protocolVersion?: string;
  logger?: Logger;
}

const DEFAULT_PROTOCOL_VERSION = '2024-11-05';

/** Error thrown when the server returns a JSON-RPC error object. */
export class McpRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'McpRpcError';
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class McpClientCore {
  private readonly transport: McpTransport;
  private readonly options: Required<Omit<McpClientOptions, 'logger'>>;
  private readonly logger?: Logger;
  private nextId = 1;
  private initialized = false;
  private serverInfo?: McpServerInfo;
  private serverCapabilities: Record<string, unknown> = {};
  private toolsListChangedHandlers: Array<() => void> = [];

  constructor(transport: McpTransport, options: McpClientOptions = {}) {
    this.transport = transport;
    this.logger = options.logger;
    this.options = {
      clientName: options.clientName ?? 'karna-gateway-client',
      clientVersion: options.clientVersion ?? '1.0.0',
      protocolVersion: options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
    };

    // Wire up server-initiated notifications (e.g. tools/list_changed).
    this.transport.onNotification?.((n) => this.handleNotification(n));
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  getServerInfo(): McpServerInfo | undefined {
    return this.serverInfo;
  }

  getServerCapabilities(): Record<string, unknown> {
    return this.serverCapabilities;
  }

  /** Subscribe to `tools/list_changed` notifications. Returns an unsubscribe fn. */
  onToolsListChanged(handler: () => void): () => void {
    this.toolsListChangedHandlers.push(handler);
    return () => {
      this.toolsListChangedHandlers = this.toolsListChangedHandlers.filter(
        (h) => h !== handler,
      );
    };
  }

  // -------------------------------------------------------------------------
  // Handshake (#543)
  // -------------------------------------------------------------------------

  async initialize(): Promise<McpInitializeResult> {
    const result = await this.request<McpInitializeResult>('initialize', {
      protocolVersion: this.options.protocolVersion,
      capabilities: {},
      clientInfo: {
        name: this.options.clientName,
        version: this.options.clientVersion,
      },
    });
    this.serverInfo = result.serverInfo;
    this.serverCapabilities = result.capabilities ?? {};
    this.initialized = true;

    // Per spec, the client sends `notifications/initialized` after handshake.
    await this.notify('notifications/initialized', {});
    this.logger?.debug({ serverInfo: this.serverInfo }, 'mcp client initialized');
    return result;
  }

  // -------------------------------------------------------------------------
  // Tools (#543)
  // -------------------------------------------------------------------------

  async listTools(): Promise<McpToolInfo[]> {
    const result = await this.request<{ tools?: McpToolInfo[] }>('tools/list', {});
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  async callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<McpCallToolResult> {
    const result = await this.request<{
      content?: McpContentBlock[];
      isError?: boolean;
    }>('tools/call', { name, arguments: args });
    return {
      content: result.content ?? [],
      isError: result.isError ?? false,
    };
  }

  // -------------------------------------------------------------------------
  // Resources (#546)
  // -------------------------------------------------------------------------

  async listResources(): Promise<McpResourceInfo[]> {
    const result = await this.request<{ resources?: McpResourceInfo[] }>(
      'resources/list',
      {},
    );
    return result.resources ?? [];
  }

  /** Raw `resources/read`. Returns the server's contents array. */
  async readResource(uri: string): Promise<McpResourceContents[]> {
    const result = await this.request<{ contents?: McpResourceContents[] }>(
      'resources/read',
      { uri },
    );
    return result.contents ?? [];
  }

  /**
   * Fetch a resource and normalise it into a context-attachment shape (#546):
   * textual parts are concatenated; binary (blob) parts are flagged but not
   * inlined.
   */
  async fetchResourceAttachment(uri: string): Promise<ResourceAttachment> {
    const contents = await this.readResource(uri);
    const textParts: string[] = [];
    let hasBinary = false;
    let mimeType: string | undefined;
    for (const c of contents) {
      if (mimeType === undefined && c.mimeType) mimeType = c.mimeType;
      if (typeof c.text === 'string') {
        textParts.push(c.text);
      } else if (typeof c.blob === 'string') {
        hasBinary = true;
      }
    }
    return {
      uri,
      mimeType,
      text: textParts.join('\n'),
      hasBinary,
    };
  }

  // -------------------------------------------------------------------------
  // Prompts (#546)
  // -------------------------------------------------------------------------

  async listPrompts(): Promise<McpPromptInfo[]> {
    const result = await this.request<{ prompts?: McpPromptInfo[] }>(
      'prompts/list',
      {},
    );
    return result.prompts ?? [];
  }

  /**
   * Resolve a reusable prompt template into concrete messages by supplying
   * argument values (#546).
   */
  async getPrompt(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<McpGetPromptResult> {
    const result = await this.request<{
      description?: string;
      messages?: McpPromptMessage[];
    }>('prompts/get', { name, arguments: args });
    return {
      description: result.description,
      messages: result.messages ?? [],
    };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async close(): Promise<void> {
    this.initialized = false;
    await this.transport.close?.();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async request<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    const res = await this.transport.send(req);
    if (!res) {
      throw new McpRpcError(
        -32603,
        `no response received for method "${method}"`,
      );
    }
    if (res.error) {
      throw new McpRpcError(res.error.code, res.error.message, res.error.data);
    }
    return res.result as T;
  }

  private async notify(method: string, params: unknown): Promise<void> {
    const req: JsonRpcRequest = { jsonrpc: '2.0', method, params };
    await this.transport.send(req);
  }

  private handleNotification(notification: JsonRpcRequest): void {
    switch (notification.method) {
      case 'notifications/tools/list_changed':
      case 'tools/list_changed':
        this.logger?.debug('mcp tools/list_changed received');
        for (const h of this.toolsListChangedHandlers) {
          try {
            h();
          } catch (err) {
            this.logger?.warn({ err }, 'tools/list_changed handler failed');
          }
        }
        break;
      default:
        this.logger?.debug(
          { method: notification.method },
          'unhandled mcp notification',
        );
    }
  }
}

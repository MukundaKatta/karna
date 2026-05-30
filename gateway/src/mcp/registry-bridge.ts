/**
 * MCP discovery & dynamic tool registration (#545).
 *
 * Bridges a connected {@link McpClientCore} to a tool registry: it discovers
 * the MCP server's tools and (re)registers them as registry-compatible tool
 * definitions, prefixed to avoid name collisions. It reacts to the
 * `tools/list_changed` notification by re-discovering and reconciling the
 * registered set, and can unregister everything on disconnect.
 *
 * The registry is consumed through a tiny structural interface
 * ({@link BridgeToolRegistry}) so this module stays decoupled and fully
 * unit-testable with a fake registry — it is satisfied by the agent's
 * `ToolRegistry`.
 */
import type { Logger } from 'pino';
import type { McpClientCore, McpToolInfo } from './client-core.js';

/**
 * Registry-compatible tool definition. Structurally a subset of the agent's
 * `ToolDefinitionRuntime` (name/description/parameters/risk/approval/timeout/
 * execute), so a produced definition can be registered directly.
 */
export interface BridgeToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;
  timeout: number;
  tags?: string[];
  /** Marks tools temporarily unavailable (e.g. server down). */
  available?: boolean;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

/** Minimal registry surface used by the bridge. Satisfied by `ToolRegistry`. */
export interface BridgeToolRegistry {
  register(tool: BridgeToolDefinition): void;
  unregister(name: string): boolean;
  has(name: string): boolean;
}

export interface RegistryBridgeOptions {
  /**
   * Prefix applied to every registered tool name to namespace this server's
   * tools (default: `mcp__<serverId>__`).
   */
  namePrefix?: string;
  /** Risk level assigned to bridged tools (default: `medium`). */
  riskLevel?: BridgeToolDefinition['riskLevel'];
  /** Whether bridged tools require approval (default: true). */
  requiresApproval?: boolean;
  /** Per-call timeout in ms (default: 30_000). */
  timeout?: number;
  logger?: Logger;
}

interface RegisteredEntry {
  /** The registry name (prefixed). */
  registryName: string;
  /** The original MCP tool name. */
  mcpName: string;
}

export class McpRegistryBridge {
  private readonly client: McpClientCore;
  private readonly registry: BridgeToolRegistry;
  private readonly serverId: string;
  private readonly namePrefix: string;
  private readonly riskLevel: BridgeToolDefinition['riskLevel'];
  private readonly requiresApproval: boolean;
  private readonly timeout: number;
  private readonly logger?: Logger;

  /** Currently registered tools, keyed by registry (prefixed) name. */
  private readonly registered = new Map<string, RegisteredEntry>();
  private unsubscribe?: () => void;
  /** Tracks whether the underlying server is currently considered available. */
  private serverAvailable = true;

  constructor(
    client: McpClientCore,
    registry: BridgeToolRegistry,
    serverId: string,
    options: RegistryBridgeOptions = {},
  ) {
    this.client = client;
    this.registry = registry;
    this.serverId = serverId;
    this.namePrefix = options.namePrefix ?? `mcp__${serverId}__`;
    this.riskLevel = options.riskLevel ?? 'medium';
    this.requiresApproval = options.requiresApproval ?? true;
    this.timeout = options.timeout ?? 30_000;
    this.logger = options.logger;
  }

  /** Registry names of all tools this bridge currently owns. */
  registeredNames(): string[] {
    return [...this.registered.keys()];
  }

  /** Map a registry (prefixed) name back to its MCP tool name. */
  resolveMcpName(registryName: string): string | undefined {
    return this.registered.get(registryName)?.mcpName;
  }

  private toRegistryName(mcpName: string): string {
    return `${this.namePrefix}${mcpName}`;
  }

  /**
   * Discover the server's tools and reconcile the registry: register new
   * tools, drop tools that vanished, and leave existing ones untouched.
   * Returns the set of registry names now owned by this bridge.
   */
  async discoverAndRegister(): Promise<string[]> {
    const tools = await this.client.listTools();
    this.reconcile(tools);
    return this.registeredNames();
  }

  /**
   * Start reacting to `tools/list_changed` notifications by re-running
   * discovery. Safe to call once; subsequent calls replace the subscription.
   */
  watchForChanges(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.client.onToolsListChanged(() => {
      void this.discoverAndRegister().catch((err) => {
        this.logger?.warn(
          { err, serverId: this.serverId },
          'mcp re-discovery after tools/list_changed failed',
        );
      });
    });
  }

  /** Mark every bridged tool available/unavailable (e.g. on health change). */
  setServerAvailable(available: boolean): void {
    if (this.serverAvailable === available) return;
    this.serverAvailable = available;
    this.logger?.debug(
      { serverId: this.serverId, available },
      'mcp bridge availability changed',
    );
    // Re-reconcile to update `available` flags on registered tool defs.
    // We re-register because the registry stores definitions by value.
    const current = [...this.registered.values()];
    for (const entry of current) {
      this.registry.unregister(entry.registryName);
    }
    this.registered.clear();
    for (const entry of current) {
      this.registerOne(entry.mcpName);
    }
  }

  /** Unregister all tools owned by this bridge and stop watching. */
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const name of this.registered.keys()) {
      this.registry.unregister(name);
    }
    this.registered.clear();
  }

  // -------------------------------------------------------------------------

  private reconcile(tools: McpToolInfo[]): void {
    const desired = new Map<string, McpToolInfo>();
    for (const t of tools) {
      desired.set(this.toRegistryName(t.name), t);
    }

    // Remove tools that no longer exist.
    for (const registryName of [...this.registered.keys()]) {
      if (!desired.has(registryName)) {
        this.registry.unregister(registryName);
        this.registered.delete(registryName);
        this.logger?.debug(
          { serverId: this.serverId, registryName },
          'mcp tool removed',
        );
      }
    }

    // Add new tools.
    for (const [registryName, info] of desired) {
      if (this.registered.has(registryName)) continue;
      this.registerOne(info.name, info);
    }
  }

  private registerOne(mcpName: string, info?: McpToolInfo): void {
    const registryName = this.toRegistryName(mcpName);
    const def = this.buildDefinition(mcpName, registryName, info);
    // Guard against pre-existing registration collisions.
    if (this.registry.has(registryName)) {
      this.registry.unregister(registryName);
    }
    this.registry.register(def);
    this.registered.set(registryName, { registryName, mcpName });
    this.logger?.debug(
      { serverId: this.serverId, registryName },
      'mcp tool registered',
    );
  }

  private buildDefinition(
    mcpName: string,
    registryName: string,
    info?: McpToolInfo,
  ): BridgeToolDefinition {
    const inputSchema = info?.inputSchema;
    const parameters = this.normaliseSchema(inputSchema);
    const description =
      info?.description ?? `MCP tool "${mcpName}" on server ${this.serverId}`;
    const client = this.client;
    const serverAvailable = this.serverAvailable;

    return {
      name: registryName,
      description,
      parameters,
      riskLevel: this.riskLevel,
      requiresApproval: this.requiresApproval,
      timeout: this.timeout,
      tags: ['mcp', 'dynamic', this.serverId],
      available: serverAvailable,
      async execute(input: Record<string, unknown>): Promise<unknown> {
        const result = await client.callTool(mcpName, input ?? {});
        return {
          serverId: undefined, // populated by callers if needed
          content: result.content,
          isError: result.isError,
        };
      },
    };
  }

  private normaliseSchema(
    inputSchema: Record<string, unknown> | undefined,
  ): BridgeToolDefinition['parameters'] {
    const properties =
      inputSchema && typeof inputSchema.properties === 'object'
        ? (inputSchema.properties as Record<string, unknown>)
        : {};
    const required = Array.isArray(inputSchema?.required)
      ? (inputSchema?.required as string[])
      : undefined;
    return { type: 'object', properties, required };
  }
}

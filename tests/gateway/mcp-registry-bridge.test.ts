import { describe, it, expect } from 'vitest';
import {
  McpRegistryBridge,
  type BridgeToolDefinition,
  type BridgeToolRegistry,
} from '../../gateway/src/mcp/registry-bridge';
import {
  McpClientCore,
  type McpTransport,
} from '../../gateway/src/mcp/client-core';
import type { JsonRpcRequest, JsonRpcResponse } from '../../gateway/src/mcp/server';

class FakeRegistry implements BridgeToolRegistry {
  readonly tools = new Map<string, BridgeToolDefinition>();
  register(tool: BridgeToolDefinition): void {
    if (this.tools.has(tool.name)) throw new Error(`dup ${tool.name}`);
    this.tools.set(tool.name, tool);
  }
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }
  has(name: string): boolean {
    return this.tools.has(name);
  }
}

/** Mock transport with a mutable tool list and notification push. */
class ProgrammableTransport implements McpTransport {
  private notif?: (n: JsonRpcRequest) => void;
  constructor(
    public toolList: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>,
    public callImpl: (name: string, args: unknown) => unknown = (name) => ({
      content: [{ type: 'text', text: `called ${name}` }],
    }),
  ) {}
  async send(req: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
    if (req.id === undefined || req.id === null) return undefined;
    if (req.method === 'tools/list') {
      return { jsonrpc: '2.0', id: req.id, result: { tools: this.toolList } };
    }
    if (req.method === 'tools/call') {
      const p = req.params as { name: string; arguments: unknown };
      return { jsonrpc: '2.0', id: req.id, result: this.callImpl(p.name, p.arguments) };
    }
    return { jsonrpc: '2.0', id: req.id, result: {} };
  }
  onNotification(handler: (n: JsonRpcRequest) => void): void {
    this.notif = handler;
  }
  push(): void {
    this.notif?.({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
  }
}

describe('McpRegistryBridge (#545)', () => {
  it('discovers and registers prefixed tools', async () => {
    const transport = new ProgrammableTransport([
      { name: 'search', description: 'searches', inputSchema: { type: 'object', properties: { q: {} }, required: ['q'] } },
      { name: 'fetch' },
    ]);
    const client = new McpClientCore(transport);
    const registry = new FakeRegistry();
    const bridge = new McpRegistryBridge(client, registry, 'srv1');

    const names = await bridge.discoverAndRegister();
    expect(names.sort()).toEqual(['mcp__srv1__fetch', 'mcp__srv1__search']);

    const search = registry.tools.get('mcp__srv1__search')!;
    expect(search.description).toBe('searches');
    expect(search.parameters).toEqual({ type: 'object', properties: { q: {} }, required: ['q'] });
    expect(search.riskLevel).toBe('medium');
    expect(search.requiresApproval).toBe(true);
    expect(bridge.resolveMcpName('mcp__srv1__search')).toBe('search');
  });

  it('executes a registered tool by proxying to the MCP client', async () => {
    const transport = new ProgrammableTransport(
      [{ name: 'echo' }],
      (name, args) => ({ content: [{ type: 'text', text: JSON.stringify({ name, args }) }], isError: false }),
    );
    const client = new McpClientCore(transport);
    const registry = new FakeRegistry();
    const bridge = new McpRegistryBridge(client, registry, 'srv1');
    await bridge.discoverAndRegister();

    const tool = registry.tools.get('mcp__srv1__echo')!;
    const out = (await tool.execute({ a: 1 })) as { content: Array<{ text: string }>; isError: boolean };
    expect(out.isError).toBe(false);
    expect(JSON.parse(out.content[0].text)).toEqual({ name: 'echo', args: { a: 1 } });
  });

  it('reconciles on re-discovery: adds new, removes vanished', async () => {
    const transport = new ProgrammableTransport([{ name: 'a' }, { name: 'b' }]);
    const client = new McpClientCore(transport);
    const registry = new FakeRegistry();
    const bridge = new McpRegistryBridge(client, registry, 's');
    await bridge.discoverAndRegister();
    expect(bridge.registeredNames().sort()).toEqual(['mcp__s__a', 'mcp__s__b']);

    // Server changes its tool set: drop b, add c.
    transport.toolList = [{ name: 'a' }, { name: 'c' }];
    await bridge.discoverAndRegister();
    expect(bridge.registeredNames().sort()).toEqual(['mcp__s__a', 'mcp__s__c']);
    expect(registry.has('mcp__s__b')).toBe(false);
  });

  it('re-discovers automatically on tools/list_changed', async () => {
    const transport = new ProgrammableTransport([{ name: 'a' }]);
    const client = new McpClientCore(transport);
    const registry = new FakeRegistry();
    const bridge = new McpRegistryBridge(client, registry, 's');
    await bridge.discoverAndRegister();
    bridge.watchForChanges();

    transport.toolList = [{ name: 'a' }, { name: 'b' }];
    transport.push();
    // re-discovery is async; flush microtasks
    await new Promise((r) => setTimeout(r, 0));
    expect(bridge.registeredNames().sort()).toEqual(['mcp__s__a', 'mcp__s__b']);
  });

  it('marks tools unavailable while the server is down', async () => {
    const transport = new ProgrammableTransport([{ name: 'a' }]);
    const client = new McpClientCore(transport);
    const registry = new FakeRegistry();
    const bridge = new McpRegistryBridge(client, registry, 's');
    await bridge.discoverAndRegister();
    expect(registry.tools.get('mcp__s__a')!.available).toBe(true);

    bridge.setServerAvailable(false);
    expect(registry.tools.get('mcp__s__a')!.available).toBe(false);

    bridge.setServerAvailable(true);
    expect(registry.tools.get('mcp__s__a')!.available).toBe(true);
  });

  it('disposes by unregistering all owned tools', async () => {
    const transport = new ProgrammableTransport([{ name: 'a' }, { name: 'b' }]);
    const client = new McpClientCore(transport);
    const registry = new FakeRegistry();
    const bridge = new McpRegistryBridge(client, registry, 's');
    await bridge.discoverAndRegister();
    bridge.dispose();
    expect(registry.tools.size).toBe(0);
    expect(bridge.registeredNames()).toEqual([]);
  });
});

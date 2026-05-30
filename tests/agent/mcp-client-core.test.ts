import { describe, it, expect } from 'vitest';
import {
  AgentMcpClient,
  AgentMcpRpcError,
  mcpListServersTool,
  mcpConnectServerTool,
  mcpListToolsTool,
  mcpCallToolTool,
  mcpDisconnectServerTool,
  type McpTransport,
  type AgentJsonRpcRequest,
  type AgentJsonRpcResponse,
} from '../../agent/src/tools/builtin/mcp-client.js';

class MockTransport implements McpTransport {
  readonly sent: AgentJsonRpcRequest[] = [];
  closed = false;
  constructor(private readonly handlers: Record<string, (params: unknown) => unknown>) {}
  async send(req: AgentJsonRpcRequest): Promise<AgentJsonRpcResponse | undefined> {
    this.sent.push(req);
    if (req.id === undefined || req.id === null) return undefined;
    const h = this.handlers[req.method];
    if (!h) {
      return { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'no method' } };
    }
    try {
      return { jsonrpc: '2.0', id: req.id, result: h(req.params) };
    } catch (err) {
      return { jsonrpc: '2.0', id: req.id, error: { code: -32603, message: (err as Error).message } };
    }
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

describe('agent additive MCP exports preserved', () => {
  it('keeps the original tool exports intact', () => {
    expect(mcpListServersTool.name).toBe('mcp_list_servers');
    expect(mcpConnectServerTool.name).toBe('mcp_connect_server');
    expect(mcpListToolsTool.name).toBe('mcp_list_tools');
    expect(mcpCallToolTool.name).toBe('mcp_call_tool');
    expect(mcpDisconnectServerTool.name).toBe('mcp_disconnect_server');
  });
});

describe('AgentMcpClient (#543, #546)', () => {
  it('initializes and sends initialized notification', async () => {
    const t = new MockTransport({
      initialize: () => ({ serverInfo: { name: 's', version: '1' } }),
    });
    const c = new AgentMcpClient(t);
    await c.initialize();
    expect(c.isInitialized).toBe(true);
    expect(t.sent.map((s) => s.method)).toEqual(['initialize', 'notifications/initialized']);
  });

  it('lists and calls tools', async () => {
    const t = new MockTransport({
      'tools/list': () => ({ tools: [{ name: 'x' }] }),
      'tools/call': (p) => {
        expect(p).toEqual({ name: 'x', arguments: { a: 1 } });
        return { content: [{ type: 'text', text: 'ok' }], isError: false };
      },
    });
    const c = new AgentMcpClient(t);
    expect(await c.listTools()).toEqual([{ name: 'x' }]);
    const res = await c.callTool('x', { a: 1 });
    expect(res).toEqual({ content: [{ type: 'text', text: 'ok' }], isError: false });
  });

  it('reads resources and prompts', async () => {
    const t = new MockTransport({
      'resources/list': () => ({ resources: [{ uri: 'u://1' }] }),
      'resources/read': () => ({ contents: [{ uri: 'u://1', text: 'data' }] }),
      'prompts/get': () => ({ messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }] }),
    });
    const c = new AgentMcpClient(t);
    expect(await c.listResources()).toEqual([{ uri: 'u://1' }]);
    expect(await c.readResource('u://1')).toEqual([{ uri: 'u://1', text: 'data' }]);
    const prompt = await c.getPrompt('greet');
    expect(prompt.messages[0].content.text).toBe('hi');
  });

  it('throws McpRpcError on server error', async () => {
    const t = new MockTransport({
      'tools/call': () => {
        throw new Error('nope');
      },
    });
    const c = new AgentMcpClient(t);
    await expect(c.callTool('x')).rejects.toBeInstanceOf(AgentMcpRpcError);
  });

  it('closes the transport', async () => {
    const t = new MockTransport({});
    const c = new AgentMcpClient(t);
    await c.close();
    expect(t.closed).toBe(true);
  });
});

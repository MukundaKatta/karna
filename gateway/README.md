# @karna/gateway

WebSocket gateway that manages multi-client connections, session state, and message routing between channels and the agent.

## Architecture

The gateway is the central hub connecting channels to the agent runtime:

```
Channels (Slack, Discord, ...) → WebSocket → Gateway → Agent
```

## Key Modules

| Module | Description |
|---|---|
| `src/index.ts` | Fastify server with WebSocket support |
| `src/protocol/` | Message protocol and authentication |
| `src/session/` | Session management and state compaction |
| `src/mcp/` | Model Context Protocol integration |
| `src/heartbeat/` | Periodic task scheduling |
| `src/health/` | Health checks and metrics |
| `src/webhooks/` | GitHub and Stripe webhook handlers |

## Usage

```bash
pnpm dev    # Start with hot reload
pnpm start  # Production mode
```

## WebSocket Keepalive

The gateway sends WebSocket ping frames every 30 seconds and closes connections
that do not answer with a pong within 10 seconds. The application-level
`heartbeat` protocol remains separate and is still used for health/status
messages inside an authenticated session.

Self-hosted load balancers and reverse proxies should allow idle WebSocket
connections for longer than the 30 second ping interval. Use at least 60 seconds
for Nginx `proxy_read_timeout`, AWS ALB idle timeout, and similar settings.

## Dependencies

- **Fastify** — HTTP and WebSocket server
- **@fastify/websocket** — WebSocket support
- **@modelcontextprotocol/sdk** — MCP integration

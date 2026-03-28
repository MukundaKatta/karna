# CLAUDE.md — Karna

## Project Context
- **Name**: Karna
- **Tagline**: Your Loyal AI Agent Platform
- **Category**: AI Agent Platform
- **Mythology**: Hindu — Warrior of the Sun (Mahabharata)
- **Stack**: TypeScript / Node.js monorepo (pnpm + Turborepo)

## Description
Self-hosted personal AI assistant platform with multi-channel messaging, extensible skills, semantic memory, and a full-stack web + mobile dashboard. Connects to Anthropic Claude and OpenAI models.

## Architecture

### Monorepo Structure
```
karna/
├── agent/          — Core agent runtime (LLM loop, tools, memory, voice)
├── gateway/        — WebSocket gateway server (Fastify + WS)
├── apps/
│   ├── web/        — Next.js 15 dashboard + chat UI
│   ├── mobile/     — Expo React Native app
│   ├── cli/        — Interactive CLI (Commander.js + Ink)
│   └── cloud/      — Cloud API (Fastify, auth, billing)
├── channels/       — 7 messaging adapters
│   ├── telegram/   — Grammy SDK
│   ├── slack/      — Slack SDK
│   ├── discord/    — Discord.js
│   ├── whatsapp/   — WhatsApp Business API
│   ├── sms/        — Twilio
│   ├── imessage/   — Native macOS
│   └── webchat/    — Browser widget
├── packages/
│   ├── shared/     — Types, utils, logger (Zod schemas)
│   ├── plugin-sdk/ — Plugin/skill development framework
│   ├── payments/   — Stripe + Razorpay integration
│   └── supabase/   — Database client (pgvector)
├── skills/         — Built-in skills (news, code-review, etc.)
└── config/         — Default configuration
```

### Key Packages
- **@karna/agent**: AgentRuntime class orchestrates: context building → model routing → tool execution → memory persistence
- **@karna/gateway**: Fastify WebSocket server with protocol-based message routing, session management, REST APIs
- **@karna/shared**: Zod-validated protocol schemas, session types, memory types
- **@karna/plugin-sdk**: Extensible skill/tool/channel plugin framework

### Data Flow
1. Client connects via WebSocket → Gateway authenticates → Session created
2. User sends `chat.message` → Gateway forwards to AgentRuntime
3. AgentRuntime: builds context (persona + memories + skills) → routes to model → streams response
4. Tool use: LLM requests tool → approval check → execute → feed result back → continue loop
5. Response streamed back via `agent.response.stream` messages
6. Session transcripts persisted to JSONL files + Supabase

## Development

### Prerequisites
- Node.js >= 20
- pnpm >= 9

### Commands
```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages (Turborepo)
pnpm dev              # Dev mode for all packages
pnpm typecheck        # Type-check all packages
pnpm gateway:dev      # Run gateway in dev mode
pnpm cli              # Run CLI
```

### Environment
Copy `.env.example` to `.env` and fill in API keys:
- `ANTHROPIC_API_KEY` — Required for Claude models
- `OPENAI_API_KEY` — Required for OpenAI models
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` — Optional persistence
- `GATEWAY_AUTH_TOKEN` — Gateway authentication

## Conventions
- All packages use ESM (`"type": "module"`)
- Strict TypeScript with Zod validation at boundaries
- Pino for structured logging
- Protocol messages validated via discriminated union schema
- Tools categorized by risk level (low/medium/high/critical)

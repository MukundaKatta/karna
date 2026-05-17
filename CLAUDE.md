# CLAUDE.md — Karna

## Project Context
- **Name**: Karna
- **Tagline**: Your Loyal AI Agent Platform
- **Category**: AI Agent Platform
- **Mythology**: Hindu — Warrior of the Sun (Mahabharata)
- **Stack**: TypeScript / Node.js monorepo (pnpm + Turborepo)

## Description
Self-hosted personal AI assistant platform with multi-channel messaging, extensible skills, semantic memory, and a full-stack web + mobile dashboard. Connects to Anthropic Claude and OpenAI models. Gateway deployed on Render; web dashboard on Vercel.

## Architecture

### Monorepo Structure
```
karna/
├── agent/          — Core agent runtime (LLM loop, tools, memory, voice, RAG, orchestration, sandbox)
├── gateway/        — WebSocket gateway server (Fastify + WS, cron, webhooks, MCP)
├── apps/
│   ├── web/        — Next.js 15 dashboard + chat UI (React 19, Tailwind, Recharts)
│   ├── mobile/     — Expo 52 React Native app (5 tabs, voice, WebRTC)
│   ├── cli/        — Interactive CLI (Commander.js + Ink, onboarding wizard)
│   └── cloud/      — Cloud API (Fastify, auth, billing, API keys, marketplace)
├── channels/       — 12 messaging adapters
│   ├── telegram/   — Grammy SDK
│   ├── slack/      — Slack SDK (with app manifest)
│   ├── discord/    — Discord.js (slash commands + embeds)
│   ├── whatsapp/   — WhatsApp Business API (Baileys)
│   ├── sms/        — Twilio (message segmentation)
│   ├── imessage/   — Native macOS only (AppleScript)
│   ├── webchat/    — Embeddable browser widget
│   ├── signal/     — signal-cli bridge
│   ├── google-chat/ — Google Chat API
│   ├── teams/      — Microsoft Bot Framework
│   ├── matrix/     — matrix-js-sdk
│   ├── irc/        — irc-framework
│   └── line/       — LINE Messaging API
├── packages/
│   ├── shared/     — Types, utils, logger, crypto (Zod schemas)
│   ├── plugin-sdk/ — Plugin/skill/tool/channel framework
│   ├── payments/   — Stripe + Razorpay (usage metering)
│   └── supabase/   — Database client (pgvector, migrations)
├── skills/         — Built-in skills (news, code-review, smart-home, daily-briefing, etc.)
├── config/         — Default configuration (JSON)
├── tests/          — 118 test files, 1175+ tests (Vitest)
├── k8s/            — Kubernetes deployment manifests
├── docs/           — OpenAPI spec, plugin SDK docs
└── scripts/        — Workspace graph checks, changelog extraction
```

### Key Packages
- **@karna/agent**: AgentRuntime orchestrates: context building → dynamic tool selection → model routing (with failover) → tool execution (sandboxed, with timeouts) → 3-tier memory persistence → response streaming
- **@karna/gateway**: Fastify WebSocket server with Zod-validated protocol, session management, graceful shutdown, WebSocket ping/pong, request logging, rate limiting, Prometheus metrics, content moderation, cron scheduler, OpenAPI spec generation
- **@karna/shared**: 31+ Zod-validated protocol message types, session/tool/skill/memory/config/orchestration/access types, crypto utilities, cost calculation
- **@karna/plugin-sdk**: Extensible skill/tool/channel plugin framework with scaffolding

### Data Flow
1. Client connects via WebSocket → Gateway authenticates (challenge-response) → Session created
2. User sends `chat.message` → Gateway validates via Zod schema → forwards to AgentRuntime
3. AgentRuntime: builds context (persona + memories + dynamically-selected tools) → routes to model (with failover chain) → streams response
4. Tool use: LLM requests tool → risk-level approval check → execute with timeout → feed result back → continue loop (up to 10 iterations)
5. Response streamed back via `agent.response.stream` messages with delta updates
6. Memory manager promotes observations through working → short-term → long-term tiers
7. Session transcripts persisted to JSONL files + Supabase

## Development

### Prerequisites
- Node.js >= 20
- pnpm >= 9

### Commands
```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages (Turborepo)
pnpm dev              # Dev mode for all packages
pnpm typecheck        # Type-check all packages (27 packages)
pnpm test             # Run all tests (Vitest, 118 files, 1175+ tests)
pnpm gateway:dev      # Run gateway in dev mode
pnpm cli              # Run CLI
```

### Environment
Copy `.env.example` to `.env` and fill in API keys:
- `ANTHROPIC_API_KEY` — Required for Claude models
- `OPENAI_API_KEY` — Required for OpenAI models (also used for embeddings)
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` — Optional persistence (pgvector for memory)
- `GATEWAY_AUTH_TOKEN` — Gateway authentication (min 16 chars in production)

### Deployment
- **Gateway**: Deployed on Render (`https://karna-gateway.onrender.com`)
- **Web**: Deployed on Vercel (auto-deploy on `main` push via CI)
- **Mobile**: EAS Build configured (Expo, project ID in `app.json`)
- **Docker**: `docker-compose.yml` (dev), `docker-compose.production.yml` (prod with Redis)
- **Kubernetes**: Manifests in `k8s/`, Helm chart values available

## Conventions
- All packages use ESM (`"type": "module"`)
- Strict TypeScript with Zod validation at boundaries
- Pino for structured logging (JSON format)
- Protocol messages validated via Zod discriminated union schema (`parseProtocolMessage`)
- Tools categorized by risk level (low/medium/high/critical) with configurable auto-approval
- Conventional commits enforced (`commitlint.config.cjs`)
- Dependabot configured for automated dependency updates

# Karna

> Named after the legendary warrior from the Mahabharata, Karna is a self-hosted AI agent platform for multichannel messaging, memory, plugins, and practical workflow automation.

[![Live Demo](https://img.shields.io/badge/Live_Demo-karna--web.vercel.app-blue?style=for-the-badge)](https://karna-web.vercel.app)
[![License](https://img.shields.io/github/license/MukundaKatta/karna?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/MukundaKatta/karna?style=flat-square)](https://github.com/MukundaKatta/karna/stargazers)
[![Tools](https://img.shields.io/badge/tools-97+-green?style=flat-square)]()
[![Channels](https://img.shields.io/badge/channels-13-orange?style=flat-square)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue?style=flat-square)]()

## What Karna Does

Karna is a **production-ready, self-hosted AI agent platform** that connects to 13+ messaging platforms and runs locally on your machine. It is designed for builders who want more than a chat demo: persistent context, operational workflows, extensibility, and real integrations across the channels people already use.

Instead of treating an agent as a single interface, Karna is structured like a platform. It combines messaging, memory, tools, orchestration, plugins, and deployment paths so an agent can stay useful over time rather than only looking impressive in a one-off interaction.

## Why Karna

**Why Karna > OpenClaw:**
- **97+ tools** — 48 core + 19 macOS + 20 app integrations + 6 iCloud/iPhone + 3 system + delegation
- **13 messaging channels** — Telegram, Slack, Discord, WhatsApp, SMS, iMessage, Webchat, Signal, Google Chat, Microsoft Teams, Matrix, IRC, LINE
- **Multi-Agent Orchestration** — supervisor/worker delegation, handoff protocol, agent pool
- **Voice Mode** — real-time Whisper STT + ElevenLabs TTS with browser UI
- **3-tier memory** — working + short-term + long-term with vector search (pgvector)
- **RAG pipeline** — document chunking, hybrid retrieval (vector + keyword + RRF)
- **Self-improvement** — learns from user feedback, auto-tunes prompts
- **Observability** — real-time trace visualization with span waterfall
- **Visual Workflows** — DAG-based automation builder (Zapier-like)
- **KarnaHub Marketplace** — browse, install, and publish community skills
- **Sandboxed execution** — Docker containers with seccomp, resource limits
- **Mac control** — apps, Finder, clipboard, screenshots, AppleScript, Siri Shortcuts
- **iPhone sync** — contacts, reminders, notes, Safari tabs via iCloud
- **App integrations** — GitHub, Google Drive, Slack, Notion, Spotify
- **Full web dashboard** — chat, agents, sessions, analytics, memory, tools, settings
- **Mobile app** — React Native (Expo) for iOS and Android
- **Canvas** — agent-generated visual interfaces pushed to clients (A2UI)
- **Plugin SDK** — build custom channels, tools, and skills
- **Self-hosted** — your data stays on your machine
- **Production-ready** — Docker, Kubernetes, CI/CD, OpenAPI docs

## Core Use Cases

- personal or team copilots that live in chat channels
- workflow automation with persistent context
- multi-channel assistants that need memory across sessions
- plugin-driven agent systems that connect to real tools
- self-hosted agent infrastructure for experimentation or production

## Quick Start

### Install (One Command)

```bash
npm install -g karna-ai
```

Then run the setup wizard:

```bash
karna onboard
```

This walks you through:
1. Setting your API key (Anthropic/OpenAI)
2. Choosing a model (Claude Sonnet 4, Opus 4, GPT-4o)
3. Connecting channels (Telegram, Discord, Slack, WhatsApp, etc.)
4. Installing skills from KarnaHub marketplace

Then start chatting:

```bash
karna chat
```

### Other install methods

<details>
<summary><b>From source (developers)</b></summary>

```bash
git clone https://github.com/MukundaKatta/karna.git
cd karna
pnpm install
pnpm build
pnpm gateway:dev    # Start gateway
pnpm cli chat       # Chat via CLI
```
</details>

<details>
<summary><b>Docker (full stack)</b></summary>

```bash
git clone https://github.com/MukundaKatta/karna.git
cd karna
cp .env.example .env   # Edit with your API keys
docker compose up -d
```
</details>

<details>
<summary><b>Web Dashboard</b></summary>

```bash
# After cloning and building:
pnpm --filter @karna/web dev
# Open http://localhost:3000
```

Or visit the hosted demo: [karna-web.vercel.app](https://karna-web.vercel.app)
</details>

## CLI Commands

```bash
karna onboard          # Interactive setup wizard
karna chat             # Start chatting with your agent
karna gateway start    # Start the gateway server
karna status           # Check gateway and agent status
karna skills           # List and manage skills
karna agents           # Manage agent configurations
karna doctor           # Diagnose installation issues
karna logs -f          # Stream gateway logs
```

### Connect a channel

```bash
# Telegram (add TELEGRAM_BOT_TOKEN to .env first)
pnpm --filter @karna/channel-telegram dev

# Discord
pnpm --filter @karna/channel-discord dev

# Slack
pnpm --filter @karna/channel-slack dev

# Any of the 13 channels:
pnpm --filter @karna/channel-<name> dev
```

### Docker (full stack)

```bash
# Start gateway + database + Redis
docker compose up -d

# With observability (Langfuse)
docker compose --profile monitoring up -d

# With local models (Ollama)
docker compose --profile local-models up -d
```

## Architecture

```
┌───────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ Telegram  │ │  Slack   │ │ Discord  │ │ +10 more │
└─────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘
      │             │            │             │
      └──────┬──────┴────────────┴──────┬──────┘
             │                          │
       ┌─────▼──────────────────────────▼─────┐
       │           Gateway (Fastify)          │
       │  WebSocket • Sessions • Auth • CORS  │
       │  Canvas • Cron • Presence • Commands │
       └─────────────────┬────────────────────┘
                         │
       ┌─────────────────▼────────────────────┐
       │          Agent Runtime               │
       │  Context Builder • Model Router      │
       │  38+ Tools • Memory • Skills • Voice │
       └────┬──────────────┬──────────────┬───┘
            │              │              │
       ┌────▼───┐    ┌────▼───┐    ┌────▼────┐
       │ Claude │    │ OpenAI │    │ Ollama  │
       └────────┘    └────────┘    └─────────┘
```

## Features

### Built-in Tools (38+)

| Category | Tools |
|----------|-------|
| **Shell** | `shell_exec` (with elevated mode) |
| **Files** | `file_read`, `file_write`, `file_list`, `file_search` |
| **Web** | `web_search`, `web_fetch` |
| **Browser** | `browser_navigate`, `browser_screenshot`, `browser_extract`, `browser_click`, `browser_fill`, `browser_eval` |
| **Calendar** | `calendar_list`, `calendar_get`, `calendar_create`, `calendar_update`, `calendar_delete` |
| **Email** | `email_list`, `email_read`, `email_send`, `email_draft`, `email_search` |
| **Code** | `code_exec`, `apply_patch` |
| **Sessions** | `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`, `session_status` |
| **Memory** | `memory_search`, `memory_get` |
| **Messaging** | `message` |
| **Image** | `image_generate` |
| **Notes** | `note_create`, `note_read`, `note_update`, `note_delete`, `note_list`, `note_search` |
| **Reminders** | `reminder_set`, `reminder_list`, `reminder_cancel` |
| **MCP** | `mcp_list_servers`, `mcp_connect`, `mcp_list_tools`, `mcp_call_tool`, `mcp_disconnect` |
| **Gateway** | `gateway_restart` |

### Workspace Configuration

Karna loads agent behavior from Markdown files in your workspace:

| File | Purpose |
|------|---------|
| `SOUL.md` | Personality, tone, behavioral boundaries |
| `AGENTS.md` | Operating contract, priorities, workflow |
| `USER.md` | User-specific knowledge and preferences |
| `TOOLS.md` | Tool usage instructions and policies |
| `IDENTITY.md` | Agent identity metadata |
| `HEARTBEAT.md` | Scheduled tasks in plain English |
| `BOOTSTRAP.md` | Initialization instructions |
| `MEMORY.md` | Curated long-term memory |

### Chat Commands

| Command | Description |
|---------|-------------|
| `/think <prompt>` | Force extended reasoning |
| `/verbose` | Toggle verbose mode |
| `/compact` | Toggle compact responses |
| `/tools` | List available tools |
| `/model <name>` | Switch model |
| `/clear` | Clear conversation |
| `/status` | Show session status |
| `/help` | Show help |

### Apps

- **Web Dashboard** (`apps/web`) — Next.js 15 with chat, analytics, session history, skill management
- **Mobile App** (`apps/mobile`) — Expo React Native with chat, memory, skills, tasks
- **CLI** (`apps/cli`) — Terminal interface with gateway management, doctor, onboarding
- **Cloud API** (`apps/cloud`) — Multi-tenant API with auth, billing (Stripe/Razorpay), rate limiting

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict) |
| Monorepo | pnpm + Turborepo |
| Agent | Anthropic Claude SDK, OpenAI SDK |
| Gateway | Fastify 5 + WebSocket |
| Web | Next.js 15, React 19, Tailwind CSS 4 |
| Mobile | Expo, React Native |
| Database | Supabase (PostgreSQL + pgvector) |
| Payments | Stripe, Razorpay |
| Voice | Whisper (STT), ElevenLabs (TTS) |
| Observability | Langfuse, Pino (structured JSON) |
| Schema | Zod validation throughout |

## Project Structure

```
karna/
├── agent/                 # Core agent runtime
│   └── src/
│       ├── runtime.ts     # Main agent loop
│       ├── models/        # LLM providers + failover
│       ├── tools/         # 38+ built-in tools
│       ├── workspace/     # Workspace config loader
│       ├── memory/        # Semantic memory + daily logs
│       ├── rag/           # RAG pipeline (chunker, retriever)
│       └── voice/         # STT/TTS pipeline
├── gateway/               # WebSocket gateway server
│   └── src/
│       ├── index.ts       # Fastify server
│       ├── protocol/      # Message routing + auth
│       ├── session/       # Session management
│       ├── canvas/        # A2UI canvas server
│       ├── cron/          # Scheduled tasks
│       ├── commands/      # Chat commands handler
│       ├── presence/      # Typing indicators
│       ├── access/        # DM/group routing policies
│       ├── audit/         # Audit logging
│       ├── mcp/           # Model Context Protocol
│       └── config/        # Config + env validation
├── apps/
│   ├── web/               # Next.js 15 dashboard
│   ├── mobile/            # Expo React Native app
│   ├── cli/               # Terminal CLI
│   └── cloud/             # Multi-tenant cloud API
├── channels/              # 13 messaging adapters
│   ├── telegram/          discord/   slack/
│   ├── whatsapp/          sms/       imessage/
│   ├── webchat/           signal/    google-chat/
│   ├── teams/             matrix/    irc/
│   └── line/
├── packages/
│   ├── shared/            # Types, utils, Zod schemas
│   ├── plugin-sdk/        # Plugin development framework
│   ├── payments/          # Stripe + Razorpay
│   └── supabase/          # Database client
├── skills/                # Built-in + community skills
├── tests/                 # 786 tests across 38 files
├── scripts/setup.sh       # One-command bootstrap
└── docker-compose.yml     # Full stack deployment
```

## Development

```bash
pnpm install          # Install dependencies
pnpm build            # Build all 23 packages
pnpm test             # Run 786 tests
pnpm gateway:dev      # Start gateway in dev mode
pnpm cli chat         # Chat via terminal
pnpm cli doctor       # Diagnose setup issues
pnpm cli status       # Check gateway status
```

## Configuration

Karna uses a layered configuration system:

1. **Default config** (`config/default.json`) — sensible defaults
2. **User config** (`~/.karna/karna.json`) — user overrides
3. **Workspace config** (`./karna.json`) — project-specific settings
4. **Environment variables** — runtime overrides (see `.env.example`)

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes and add tests
4. Run `pnpm test` to verify
5. Submit a pull request

## License

Proprietary — Officethree Technologies. All Rights Reserved.

## Part of the Mythological Portfolio

This is project **#karna** in the [100-project Mythological Portfolio](https://github.com/MukundaKatta) by Officethree Technologies.

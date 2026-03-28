# Karna — Your Loyal AI Agent Platform

> Named after the legendary warrior from the Mahabharata, Karna is a self-hosted AI assistant platform with multi-channel messaging, extensible skills, and semantic memory.

[![GitHub Pages](https://img.shields.io/badge/Live_Demo-Visit_Site-blue?style=for-the-badge)](https://MukundaKatta.github.io/karna/)
[![License](https://img.shields.io/github/license/MukundaKatta/karna?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/MukundaKatta/karna?style=flat-square)](https://github.com/MukundaKatta/karna/stargazers)

## What is Karna?

Karna is a **production-ready, self-hosted AI agent** that connects to 13+ messaging platforms and runs locally on your machine. Think of it as your personal AI assistant that lives in your chat apps.

**Key differentiators:**
- **13 messaging channels** — Telegram, Slack, Discord, WhatsApp, SMS, iMessage, Webchat, Signal, Google Chat, Microsoft Teams, Matrix, IRC, LINE
- **38+ built-in tools** — shell, files, web search, browser automation, calendar, email, code execution, image generation, and more
- **Semantic memory** — remembers context across conversations with vector-based retrieval
- **Voice** — speech-to-text (Whisper) and text-to-speech (ElevenLabs) pipeline
- **Canvas** — agent-generated visual interfaces pushed to clients (A2UI)
- **Plugin SDK** — build custom channels, tools, and skills
- **Self-hosted** — your data stays on your machine

## Install (One Command)

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

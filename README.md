# Karna

> Karna is an AI chief of staff for chats, voice notes, and follow-through. It helps you capture what matters, remember context, and turn conversations into finished work across the channels you already use.

[![Live Demo](https://img.shields.io/badge/Live_Demo-karna--web--0osh.onrender.com-blue?style=for-the-badge)](https://karna-web-0osh.onrender.com/landing.html)
[![License](https://img.shields.io/github/license/MukundaKatta/karna?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/MukundaKatta/karna?style=flat-square)](https://github.com/MukundaKatta/karna/stargazers)
[![Tools](https://img.shields.io/badge/tools-97+-green?style=flat-square)]()
[![Channels](https://img.shields.io/badge/channels-13-orange?style=flat-square)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue?style=flat-square)]()

## What Karna Is

Karna is designed around a simple product promise: your assistant should live where your day already happens. Instead of forcing you into one inbox or one dashboard, Karna can sit in chat, pick up voice notes, remember ongoing context, and help you close loops without bouncing between apps.

Today, Karna ships as a **self-hosted, production-ready assistant stack** with web, mobile, CLI, memory, workflows, and 13+ messaging channels. That makes it a strong fit right now for builders, operators, and power users who want a daily-use assistant instead of a one-off demo.

## Why People Keep Karna Around

- **It meets you in chat** — web, mobile, and 13 messaging channels let Karna show up where conversations already happen.
- **Voice is first-class** — send voice notes, run live voice flows, and keep moving when typing is too slow.
- **It remembers ongoing work** — working, short-term, and long-term memory keep context alive across sessions.
- **It turns conversation into action** — workflows, tools, plugins, and integrations help Karna do more than answer questions.
- **It stays safe by default** — pairing for DMs, mention-only groups, and allowlists keep shared channels under control.
- **It scales with you** — start with one assistant, then grow into dashboards, workflows, automation, and custom skills.

## What Makes Karna Powerful

- **97+ tools** — shell, files, browser, messaging, memory, notes, reminders, image generation, and more
- **13 messaging channels** — Telegram, Slack, Discord, WhatsApp, SMS, iMessage, Webchat, Signal, Google Chat, Microsoft Teams, Matrix, IRC, LINE
- **Voice mode** — browser voice UI plus live WebRTC voice session support
- **3-tier memory** — working + short-term + long-term recall
- **Multi-agent orchestration** — delegation, handoff, and agent pools
- **Visual workflows** — automations and repeatable operational flows
- **Full operator surface** — web dashboard, mobile app, CLI, analytics, traces, sessions, memory, settings
- **Self-hosted control** — your data, your keys, your infrastructure
- **Production foundations** — Docker, Kubernetes, CI/CD, auditability, OpenAPI docs

## Core Use Cases

- catching up on messages, commitments, and loose follow-ups
- turning voice notes into action items, reminders, or replies
- running a personal or team assistant inside your real chat channels
- keeping one assistant identity across web, mobile, and messaging apps
- automating recurring check-ins, digests, triage, and operational work

## Who It Is For Today

- builders and power users who want a serious daily-use assistant, not a toy demo
- teams experimenting with chat-native copilots and internal automation
- privacy-conscious users who want self-hosted control with a consumer-style surface
- developers building custom skills, tools, and channel integrations

## Quick Start

### Install (Fastest Path Today)

> **Heads up:** the `karna-ai` npm package is not yet published. Use the [From source](#other-install-methods) or Docker path below. The command here describes the intended UX once `karna-ai` ships.

```bash
npm install -g karna-ai
```

Then run the setup wizard:

```bash
karna onboard
```

This walks you through:
1. Naming Karna for your chats
2. Choosing the model behind your assistant
3. Picking the first channel where Karna should show up
4. Setting DM and group safety defaults
5. Turning on memory if you want persistent recall

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

Or visit the hosted demo: [karna-web-0osh.onrender.com](https://karna-web-0osh.onrender.com/landing.html)
</details>

For a real public deployment, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the Render full-stack Blueprint and the Vercel-backed alternative.

## CLI Commands

```bash
karna onboard          # Set up Karna as your everyday assistant
karna chat             # Start chatting with Karna
karna gateway start    # Start the gateway server
karna status           # Check Karna and gateway status
karna skills           # List and manage skills
karna agents           # Manage agent configurations
karna doctor           # Diagnose installation issues
karna logs -f          # Stream gateway logs
```

### DM Access and Group Safety

Karna now treats inbound messaging channels defensively by default:

- `pairing` DMs: unknown senders get a short approval code before Karna processes their messages
- `mention` groups: Karna only responds in group chats when mentioned or replied to
- `allowlist` groups: Karna only responds to explicitly approved people in shared channels

Useful commands:

```bash
karna access list
karna access show telegram
karna access approve telegram <code>
karna access dm-mode telegram pairing
karna access group-mode telegram mention
karna access group-mode telegram allowlist
karna doctor
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

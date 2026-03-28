# Contributing to Karna

Thank you for your interest in contributing to Karna! This guide will help you get started.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/MukundaKatta/karna.git
cd karna

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start development
pnpm gateway:dev    # Terminal 1: Gateway
pnpm --filter @karna/web dev  # Terminal 2: Web dashboard
pnpm cli chat       # Terminal 3: CLI chat
```

## Project Structure

```
karna/
├── agent/          # Core AI agent runtime (models, tools, memory, RAG)
├── gateway/        # WebSocket gateway server (Fastify)
├── apps/
│   ├── web/        # Next.js dashboard
│   ├── cli/        # Commander.js CLI
│   ├── cloud/      # Cloud API service
│   └── mobile/     # React Native (Expo) app
├── channels/       # 13 messaging channel adapters
├── skills/         # Built-in and community skills
├── packages/
│   ├── shared/     # Shared types and utilities
│   ├── plugin-sdk/ # Plugin development SDK
│   └── supabase/   # Database migrations
├── tests/          # Vitest test suites
└── docker/         # Docker deployment configs
```

## Key Commands

| Command | Description |
|---------|------------|
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm gateway:dev` | Start gateway in dev mode |
| `pnpm --filter @karna/web dev` | Start web dashboard |
| `pnpm cli chat` | Start CLI chat |

## Adding a New Tool

1. Create `agent/src/tools/builtin/your-tool.ts`
2. Export a tool object with: `name`, `description`, `parameters` (Zod), `inputSchema`, `riskLevel`, `requiresApproval`, `execute`
3. Register in `agent/src/tools/builtin/index.ts`
4. Add tests in `tests/agent/`

## Adding a New Channel

1. Create `channels/your-channel/src/adapter.ts`
2. Follow the Discord adapter pattern (connect to gateway WS, forward messages)
3. Add `channels/your-channel/package.json`

## Adding a New Skill

1. Create `skills/builtin/your-skill/SKILL.md` (YAML frontmatter + instructions)
2. Create `skills/builtin/your-skill/handler.ts` (implements `SkillHandler`)
3. Skills are auto-discovered by the skill loader

## Code Style

- TypeScript strict mode
- pino for logging
- Zod for validation
- No `any` types (use `unknown` instead)
- Functional over OOP where possible
- Keep files under 500 lines

## Pull Requests

1. Fork the repo and create a feature branch
2. Write tests for new features
3. Ensure `pnpm build` and `pnpm test` pass
4. Submit a PR with a clear description

## License

MIT — see [LICENSE](LICENSE)

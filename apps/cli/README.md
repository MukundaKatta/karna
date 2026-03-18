# @karna/cli

Command-line interface for managing and interacting with Karna.

## Features

- Interactive chat with your Karna agent
- Onboarding wizard for first-time setup
- Agent and gateway status monitoring
- Skills and channel management
- Diagnostic tools (`karna doctor`)

## Setup

```bash
pnpm install
pnpm build
```

## Usage

```bash
# Start interactive chat
karna chat

# Run onboarding wizard
karna onboard

# Check system status
karna status

# Manage gateway
karna gateway start
```

## Development

```bash
pnpm dev   # Run with tsx in watch mode
```

## Dependencies

- **commander** — CLI framework
- **inquirer** — Interactive prompts
- **chalk / ora** — Terminal styling and spinners
- **ws** — WebSocket client for gateway communication

# Karna

> Your Loyal AI Agent Platform

## Overview

Karna is a self-hosted personal AI assistant platform with multi-channel messaging, extensible skills, and semantic memory. Named after the legendary warrior known for his unwavering loyalty, Karna serves as your dedicated AI companion across all communication channels.

Built for developers and businesses who want full control over their AI assistant — no vendor lock-in, no data leaving your servers, complete customization.

## Key Features

- **Multi-Channel Messaging** — Slack, Discord, WhatsApp, SMS, email, and custom integrations
- **Extensible Skills** — Plugin architecture for adding new capabilities
- **Semantic Memory** — Long-term memory with vector search for contextual conversations
- **Self-Hosted** — Deploy on your own infrastructure with full data ownership
- **Conversation Threading** — Maintains context across multi-turn conversations
- **Role-Based Access** — Fine-grained permissions for team deployments
- **API-First Design** — RESTful API for programmatic access

## Tech Stack

- **Backend:** Python, FastAPI
- **AI:** Claude API, OpenAI API, local models via Ollama
- **Memory:** PostgreSQL, pgvector
- **Messaging:** WebSocket, webhooks
- **Deployment:** Docker, Kubernetes

## Getting Started

```bash
git clone https://github.com/MukundaKatta/karna.git
cd karna
cp .env.example .env  # Configure API keys
docker-compose up -d
```

## Architecture

```
karna/
├── core/          # Agent orchestration engine
├── channels/      # Multi-channel adapters
├── skills/        # Extensible skill plugins
├── memory/        # Semantic memory & vector store
└── api/           # REST API layer
```

---

**Mukunda Katta** · [Officethree Technologies](https://github.com/MukundaKatta/Office3) · 2026

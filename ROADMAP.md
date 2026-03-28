# Karna — Next Level Roadmap

> Based on deep competitive research, codebase audit, and production architecture analysis.

---

## Tier 1: Critical Production Gaps (Must-Fix)

### 1.1 Security Hardening
- [ ] **Require `GATEWAY_AUTH_TOKEN` in production** — currently auto-bypasses auth if unset (`auth.ts:36-38`)
- [ ] **Fix hard-coded JWT secret** — `"karna-cloud-dev-secret-change-me"` in `middleware/auth.ts:27`
- [ ] **Add startup env validation** — fail fast if `ANTHROPIC_API_KEY`, `JWT_SECRET`, `GATEWAY_AUTH_TOKEN` missing
- [ ] **CORS lockdown** — default is `"*"`, needs allowlist per environment
- [ ] **Add security headers** — X-Frame-Options, X-Content-Type-Options, CSP, HSTS
- [ ] **WebSocket origin validation** — no origin check on upgrade requests
- [ ] **Per-message rate limiting** on WebSocket connections
- [ ] **Add `process.on('unhandledRejection')` and `process.on('uncaughtException')` handlers**

### 1.2 Docker Compose Deployment
- [ ] Create `docker-compose.yml` with: gateway, web dashboard, PostgreSQL+pgvector, Redis
- [ ] Create `Dockerfile` for gateway and web
- [ ] Add health checks for all services
- [ ] Document one-command self-hosting: `docker compose up`

### 1.3 Database Migrations & Schema
- [ ] Verify all 13 Supabase migrations run cleanly
- [ ] Add missing columns: `memories.embedding vector(1536)`, API key expiration/rotation fields
- [ ] Add audit logs table for compliance
- [ ] Create `seed.sql` for default agent configuration

### 1.4 Environment & Config Validation
- [ ] Add Zod-based startup validation for all env vars
- [ ] Validate secret strength (JWT secret >= 32 chars, not default value)
- [ ] Validate database connectivity at startup
- [ ] Add `NODE_ENV` awareness (dev/staging/production behaviors)

---

## Tier 2: Feature Completeness

### 2.1 RAG Document Pipeline
- [ ] Document ingestion endpoint (PDF, Markdown, HTML, DOCX)
- [ ] Recursive character chunking (400 tokens, 50-token overlap)
- [ ] Embedding generation via OpenAI `text-embedding-3-small`
- [ ] Store chunks in pgvector with metadata (source, section, type)
- [ ] Hybrid search: pgvector similarity + PostgreSQL `tsvector` BM25
- [ ] Reciprocal Rank Fusion for combining search results
- [ ] Cross-encoder reranking (top-20 → top-5)
- [ ] New tool: `knowledge_search` for agent to query document store

### 2.2 Three-Tier Memory System
- [ ] **Working memory**: In-process per-request (current conversation context)
- [ ] **Short-term memory**: PostgreSQL session-scoped (hours/days)
- [ ] **Long-term memory**: PostgreSQL + pgvector persistent (user prefs, facts, entities)
- [ ] Memory importance scoring: `recency_decay * access_frequency * relevance`
- [ ] Rolling summarization when history exceeds token budget
- [ ] Memory garbage collection for low-importance entries
- [ ] Tag memories as episodic/semantic/procedural with different retention

### 2.3 Multi-Agent Architecture
- [ ] Supervisor/Worker pattern for complex tasks
- [ ] Agent definitions as config: `{ name, systemPrompt, model, tools[], handoffTargets[] }`
- [ ] Explicit handoff protocol with `HandoffPayload` schema
- [ ] Maximum handoff depth (5) to prevent loops
- [ ] Router agent for channel dispatch to specialized agents
- [ ] Agent registry in gateway for managing multiple agent instances

### 2.4 Observability (Langfuse Integration)
- [ ] Deploy Langfuse via Docker Compose alongside Karna
- [ ] Instrument agent runtime with Langfuse/OpenTelemetry SDK
- [ ] Track: latency (p50/p95/p99), token usage, cost, tool success rates
- [ ] Trace visualization for agent loops (context → model → tools → response)
- [ ] Alerts: p99 > 10s, error rate > 5%, loop detection > 10 steps
- [ ] Dashboard for conversation quality metrics

### 2.5 Streaming Architecture Improvements
- [ ] Backpressure handling: monitor `ws.bufferedAmount`, pause on high watermark
- [ ] Redis-backed replay buffer for reconnection recovery
- [ ] Sequence numbers on stream chunks for gap detection
- [ ] Periodic checkpoint events with accumulated text

---

## Tier 3: Competitive Differentiators

### 3.1 MCP Server & Client
- [ ] Complete the MCP server in `gateway/src/mcp/`
- [ ] Expose Karna's tools via MCP for external consumption
- [ ] MCP client for connecting to external MCP servers (databases, APIs)
- [ ] Registry of popular MCP servers users can connect with one click

### 3.2 Scheduled Automation
- [ ] Cron-based task scheduling (daily briefings, periodic checks)
- [ ] Event-triggered workflows (webhook → skill chain)
- [ ] Background agent execution with notification on completion

### 3.3 Conversation Branching & Forking
- [ ] Branch conversations to explore alternatives
- [ ] Fork a conversation at any point
- [ ] Compare outcomes of different branches

### 3.4 Collaborative Sessions
- [ ] Multiple users can join a session via invite link
- [ ] Redis pub/sub for cross-instance event fan-out
- [ ] Per-session event sourcing for full audit trail
- [ ] Shared context with per-user permissions

### 3.5 Plugin Marketplace
- [ ] Publish skills to a community registry
- [ ] Install/uninstall skills via CLI or web dashboard
- [ ] Skill versioning and dependency management
- [ ] Rating and review system

---

## Tier 4: Channel & Skill Polish

### 4.1 Fix Channel Adapters
- [ ] **WhatsApp**: Migrate from Baileys (ToS violation) to official WhatsApp Business API
- [ ] **Telegram**: Add media handling, group chat support, webhook mode
- [ ] **Discord**: Add embed formatting, thread support, permission checks
- [ ] **Slack**: Add Block Kit formatting, file handling, workspace context
- [ ] **SMS**: Complete Twilio webhook handler, add DLR tracking, signature validation
- [ ] **iMessage**: Implement or remove (macOS-only, limited API)

### 4.2 Fix Skills
- [ ] **News Digest**: Wire `fetchNewsForTopic()` to web_search tool (currently returns empty)
- [ ] **All stubs**: Audit and implement or remove: daily-briefing, travel-planner, meeting-prep, expense-tracker, health-tracker, smart-home
- [ ] Add skill testing framework

### 4.3 Voice Pipeline
- [ ] Verify STT (Whisper) integration works end-to-end
- [ ] Verify TTS (ElevenLabs) integration works end-to-end
- [ ] Add voice activity detection for mobile
- [ ] Stream audio for real-time voice conversations

---

## Tier 5: Scale & Production Hardening

### 5.1 Tool Execution Sandboxing
- [ ] Docker containers + seccomp profiles for shell/code execution
- [ ] Capability-based permission system per tool
- [ ] Resource limits: CPU (1 core), memory (512MB), time (30s), network (allowlist)
- [ ] Separate trust tiers: API calls (in-process) vs code exec (container)

### 5.2 Kubernetes Support
- [ ] Helm chart for Karna deployment
- [ ] HPA for gateway (scale on connection count)
- [ ] Agent worker scaling via Redis/NATS job queue
- [ ] Sticky sessions for WebSocket on Ingress

### 5.3 CI/CD Pipeline
- [ ] GitHub Actions: lint, typecheck, test, build on every PR
- [ ] Container image builds and push to GHCR
- [ ] Automated Supabase migration runs
- [ ] E2E test suite with Playwright

### 5.4 Performance
- [ ] Redis caching for session data and hot queries
- [ ] Connection pooling for database
- [ ] Prompt caching (Anthropic cache_control)
- [ ] Batch embedding generation for bulk document ingestion

---

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Vector DB | pgvector (start) → Qdrant (scale) | Single-DB simplicity; proven to 10-20M vectors |
| Observability | Langfuse (self-hosted) | MIT, OTEL-native, Docker Compose deploy |
| Memory | 3-tier in PostgreSQL | ACID, hybrid search, row-level security |
| RAG | Hybrid BM25+vector with reranker | Consensus best practice |
| Multi-agent | Supervisor/Worker + Router | Covers 90% of use cases |
| Tool sandbox | Docker+seccomp → Firecracker (scale) | Defense-in-depth, zero-trust |
| Deployment | Docker Compose → K8s | Fastest to production, clear scale path |
| Streaming | WebSocket + backpressure + Redis replay | Handles slow clients, reconnection |

# Trends-2026 Backlog — Implementation Reconciliation

This document maps each of the 100 `trends-2026` backlog issues (#522–#621, plus
the verification of #588) to the file(s) that implement it and the PR that merged
it. It exists because a few issue numbers referenced in early commit messages were
approximate; this is the authoritative mapping.

**Status legend**
- ✅ **merged** — code on `main`, CI-green (typecheck + tests + build).
- 🎨 **needs-visual-verification** — UI compiles/builds green but was not clicked
  through in a running app; labelled on the issue.

**Important caveat (applies to all):** modules are **additive and opt-in** — most
are pure/standalone and **not yet wired into the live runtime**, so default
behavior is unchanged until adopted. See each PR's integration notes.

PRs: #622 (wave 1), #623 (wave 2), #624 (wave 3), #625 (wave 4), #626 (wave 5 UI),
#627 (#588).

---

## Agent runtime / orchestration

| Issue | Title | Implementing file(s) | PR |
|------|-------|----------------------|----|
| #522 | Plan-Execute-Verify phase-gating | `agent/src/orchestration/phase-gate.ts` | #624 |
| #523 | Agent control-plane config | `packages/shared/src/types/control-plane.ts` | #622 |
| #524 | Snapshot/checkpoint recovery | `agent/src/checkpoint/checkpoint.ts` | #624 |
| #525 | Deterministic session replay | `agent/src/checkpoint/replay.ts` | #624 |
| #526 | Pluggable orchestration strategies | `agent/src/orchestration/strategies.ts` | #624 |
| #527 | Multi-sandbox parallel sub-agents | `agent/src/orchestration/parallel-subagents.ts` | #624 |
| #528 | Hierarchical task decomposition | `agent/src/orchestration/task-tree.ts` | #624 |
| #529 | Workflow DAG executor | `agent/src/workflows/dag.ts` | #624 |
| #530 | Agent run state machine | `agent/src/orchestration/run-state.ts` | #624 |
| #531 | Sub-agent result aggregation | `agent/src/orchestration/aggregation.ts` | #624 |
| #532 | Per-phase budget caps | `agent/src/orchestration/budget.ts` | #624 |

## Memory

| Issue | Title | Implementing file(s) | PR |
|------|-------|----------------------|----|
| #533 | Observer agent | `agent/src/memory/observer.ts` | #624 |
| #534 | Reflector agent | `agent/src/memory/reflector.ts` | #624 |
| #535 | Tier eviction & TTL | `agent/src/memory/eviction.ts` | #624 |
| #536 | Semantic dedup | `agent/src/memory/dedup.ts` | #624 |
| #537 | Importance scoring & decay | `agent/src/memory/scoring.ts` | #624 |
| #538 | Per-user/channel namespaces | `agent/src/memory/namespace.ts` | #624 |
| #539 | Export/import portability | `agent/src/memory/portability.ts` | #624 |
| #540 | Episodic vs semantic | `agent/src/memory/memory-types.ts` | #624 |
| #541 | Recall relevance eval | `agent/src/memory/recall-eval.ts` | #624 |
| #542 | PII redaction | `agent/src/memory/pii-redaction.ts` | #624 |
| #621 | Knowledge-graph memory | `agent/src/memory/graph-memory.ts` | #625 |

## MCP

| Issue | Title | Implementing file(s) | PR |
|------|-------|----------------------|----|
| #543 | MCP client (external servers) | `gateway/src/mcp/client-core.ts`; `agent/src/tools/builtin/mcp-client.ts` | #624 |
| #544 | Expose karna as MCP server | `gateway/src/mcp/server.ts` | #622 |
| #545 | MCP discovery & registration | `gateway/src/mcp/registry-bridge.ts` | #624 |
| #546 | MCP resources & prompts | `gateway/src/mcp/client-core.ts` | #624 |
| #553 | MCP health & reconnection | `gateway/src/mcp/health.ts` | #624 |

## Tools

| Issue | Title | Implementing file(s) | PR |
|------|-------|----------------------|----|
| #547 | JSON-schema tool validation | `agent/src/tools/validation.ts` | #622 |
| #548 | Tool result caching | `agent/src/tools/result-cache.ts` | #622 |
| #549 | Tool versioning & deprecation | `packages/plugin-sdk/src/versioning.ts` | #622 |
| #550 | Streaming tool results | `agent/src/tools/streaming.ts` | #624 |
| #551 | Tool dry-run / preview | `agent/src/tools/dry-run.ts` | #622 |
| #552 | Per-tool rate limiting | `agent/src/tools/rate-limiter.ts` | #622 |

## Security / sandbox

| Issue | Title | Implementing file(s) | PR |
|------|-------|----------------------|----|
| #554 | Container sandbox isolation | `agent/src/sandbox/isolation.ts` | #624 |
| #555 | Open Agent Passport authz | `agent/src/tools/security/passport.ts` | #624 |
| #556 | Pre-exec policy engine | `agent/src/tools/security/policy-engine.ts` | #624 |
| #557 | Per-tool egress allowlists | `agent/src/tools/security/egress.ts` | #624 |
| #558 | Filesystem scoping | `agent/src/tools/security/fs-scope.ts` | #624 |
| #559 | Secrets vault integration | `agent/src/tools/security/secrets.ts` | #624 |
| #560 | Prompt-injection detection | `agent/src/tools/security/injection.ts` | #624 |
| #561 | Tamper-evident audit log | `gateway/src/audit/hash-chain.ts` | #622 |
| #562 | Capability-based access tokens | `packages/shared/src/types/capability.ts` | #622 |
| #563 | Per-sandbox resource limits | `agent/src/sandbox/limits.ts` | #624 |
| #564 | Signed plugin verification | `packages/plugin-sdk/src/signing.ts` | #622 |
| #565 | Data-exfiltration guardrails | `agent/src/tools/security/exfil.ts` | #624 |

## Evals

| Issue | Title | Implementing file(s) | PR |
|------|-------|----------------------|----|
| #566 | Eval harness framework | `agent/src/evals/framework.ts` | #624 |
| #567 | SWE-bench-style task runner | `agent/src/evals/task-runner.ts` | #624 |
| #568 | Regression eval suite in CI | `tests/evals/regression.test.ts`; `.github/workflows/regression-evals.yml` | #625 |
| #569 | Golden transcript snapshots | `agent/src/evals/golden.ts` | #624 |
| #570 | LLM-as-judge | `agent/src/evals/judge.ts` | #624 |
| #571 | Tool-use accuracy bench | `agent/src/evals/tool-use-bench.ts` | #624 |
| #572 | Model routing A/B | `agent/src/evals/routing-ab.ts` | #624 |
| #573 | Latency & cost bench | `agent/src/evals/latency-cost-bench.ts` | #624 |
| #575 | Red-team / jailbreak suite | `agent/src/evals/redteam.ts` | #624 |
| #574 🎨 | Eval results dashboard | `apps/web/app/dashboard/evals/page.tsx` (+ `[id]`), `apps/web/app/api/evals/route.ts` | #626/#625 |

## Observability

| Issue | Title | Implementing file(s) | PR |
|------|-------|----------------------|----|
| #576 | OpenTelemetry tracing | `gateway/src/observability/spans.ts` | #622 |
| #577 | Per-LLM-call trace capture | `gateway/src/observability/llm-trace.ts` | #624 |
| #578 | Cost tracking per user/session/tool | `packages/shared/src/utils/cost-attribution.ts`; `apps/web/app/api/costs/route.ts` | #622/#625 |
| #580 | Expanded Prometheus metrics | `gateway/src/health/extra-metrics.ts` | #622 |
| #581 | Trace export to backends | `gateway/src/observability/exporters.ts` | #624 |
| #584 | Error tracking (Sentry-compatible) | `gateway/src/observability/error-reporter.ts` | #625 |
| #585 | SLOs & alerting | `gateway/src/slo/definitions.ts` | #625 |
| #579 🎨 | Token & cost usage dashboard | `apps/web/app/dashboard/usage/page.tsx`, `apps/web/app/api/usage/route.ts` | #626/#625 |
| #582 🎨 | Session replay viewer | `apps/web/app/dashboard/sessions/[id]/replay/page.tsx` | #626 |
| #583 🎨 | Real-time run timeline | `apps/web/components/RunTimeline.tsx`, `apps/web/app/dashboard/timeline/page.tsx` | #626 |
| #611 🎨 | Web run debugger panel | `apps/web/components/RunDebugger.tsx`, `apps/web/app/dashboard/debugger/page.tsx` | #626 |

## Human-in-the-loop approvals

| Issue | Title | Implementing file(s) | PR |
|------|-------|----------------------|----|
| #587 | Per-risk-level approval policies | `agent/src/approval/policies.ts` | #625 |
| #588 | Channel inline approve/deny | `channels/_shared/inline-approval.ts`; `agent/src/approval/inline-approval.ts` | #627/#625 |
| #589 | Pause/resume runs | `agent/src/approval/pause-resume.ts` | #625 |
| #590 | Edit-and-continue tool args | `agent/src/approval/edit-continue.ts` | #625 |
| #591 | Approval audit trail | `agent/src/approval/audit-trail.ts` | #625 |
| #586 🎨 | Approval UI (web + mobile) | `apps/web/app/dashboard/approvals/page.tsx`; `apps/mobile/components/PendingApprovals.tsx` | #626 |

## Model routing

| Issue | Title | Implementing file(s) | PR |
|------|-------|----------------------|----|
| #592 | Prompt caching (Anthropic) | `agent/src/models/prompt-cache.ts` | #623 |
| #593 | Harden failover chain | `agent/src/models/circuit-breaker.ts` | #623 |
| #594 | Cost-aware model routing | `agent/src/models/cost-router.ts` | #625 |
| #595 | Local model provider | `agent/src/models/local-provider.ts` | #623 |
| #596 | Streaming token budget | `packages/shared/src/utils/budget.ts` | #622 |
| #597 | Rate-limit-aware backoff | `agent/src/models/rate-limit-backoff.ts` | #625 |

## RAG

| Issue | Title | Implementing file(s) | PR |
|------|-------|----------------------|----|
| #598 | Hybrid search (BM25 + vector) | `agent/src/rag/hybrid.ts` | #622 |
| #599 | Ingestion & chunking | `agent/src/rag/ingestion.ts` | #622 |
| #600 | Reranking stage | `agent/src/rag/rerank.ts` | #622 |
| #601 | Citation / source attribution | `agent/src/rag/citations.ts` | #622 |
| #602 | Incremental re-indexing | `agent/src/rag/incremental.ts` | #622 |

## Voice

| Issue | Title | Implementing file(s) | PR |
|------|-------|----------------------|----|
| #603 | Streaming STT/TTS | `agent/src/voice/streaming.ts` | #622 |
| #604 | Barge-in / interruption | `agent/src/voice/barge-in.ts` | #622 |
| #605 | Tunable VAD | `agent/src/voice/vad-config.ts` | #622 |

## Channels

| Issue | Title | Implementing file(s) | PR |
|------|-------|----------------------|----|
| #606 | Capability matrix | `channels/_shared/capabilities.ts` | #622 |
| #607 | Rate limiting & backpressure | `channels/_shared/rate-limit.ts` | #622 |
| #608 | Rich interactive components | `channels/_shared/inline-approval.ts` + `capabilities.ts` | #627/#622 |
| #609 | Delivery retries & DLQ | `channels/_shared/delivery.ts` | #622 |
| #610 | Mastodon adapter | `channels/mastodon/src/adapter.ts` | #622 |

## Plugin SDK

| Issue | Title | Implementing file(s) | PR |
|------|-------|----------------------|----|
| #616 | Hot-reload skills (dev) | `packages/plugin-sdk/src/hot-reload.ts` | #622 |
| #617 | Skill scaffolding eval template | `packages/plugin-sdk/src/scaffold-eval.ts` | #622 |

## Apps / infra

| Issue | Title | Implementing file(s) | PR |
|------|-------|----------------------|----|
| #613 | CLI non-interactive JSON mode | `apps/cli/src/lib/headless.ts`, `apps/cli/src/commands/run.ts` | #625 |
| #614 | Cloud billing metering | `apps/cloud/src/billing/metering.ts` | #625 |
| #615 🎨 | Marketplace browse/install UI | `apps/web/app/marketplace/page.tsx` (+ `[id]`) | #626 |
| #618 | k8s HPA | `k8s/deployment.yaml` (HorizontalPodAutoscaler) | #625 |
| #619 | Graceful drain + checkpointing | `gateway/src/shutdown/drain.ts` | #625 |
| #620 | Computer-use / browser tool | `agent/src/tools/builtin/browser.ts` (pre-existing; verified) | #622 |
| #612 🎨 | Mobile push notifications | `apps/mobile/lib/notifications.ts` | #626 |

---

## Wiring status

Everything above is **merged and tested**, but most modules are **not yet active
in the runtime**. The recommended adoption order (highest value, lowest risk):

1. **Tool input validation (#547)** → enforce in `agent/src/tools/executor.ts`
   (already opt-in when a tool has a Zod `inputSchema`).
2. **Prompt caching (#592)** → route Anthropic requests through `planPromptCache`.
3. **Per-tool rate limiting (#552) + result caching (#548)** → wrap executor calls.
4. **Security policy engine (#556) + passport (#555)** → pre-execution hook.
5. **MCP client (#543)** → register discovered tools at gateway startup behind config.

Each should land as its own small PR with an integration test, behind a default-off
flag so production behavior stays unchanged until explicitly enabled.

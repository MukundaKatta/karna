// ─── Multi-Agent Orchestration ────────────────────────────────────────────────
//
// Barrel export for the orchestration system.
//
// ──────────────────────────────────────────────────────────────────────────────

export { AgentPool, type PoolEntry, type AgentPoolConfig } from "./agent-pool.js";
export {
  executeHandoff,
  HandoffLoopError,
  HandoffDepthError,
  type HandoffOptions,
} from "./handoff.js";
export { Supervisor, type SupervisorConfig, type SubTask } from "./supervisor.js";
export {
  Orchestrator,
  type OrchestratorConfig,
  type DelegationCallback,
} from "./orchestrator.js";

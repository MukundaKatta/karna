// ─── Sandbox Barrel ───────────────────────────────────────────────────────
//
// Re-exports the sandbox modules. Existing direct imports of
// `./docker-sandbox.js` continue to work unchanged; this barrel is additive.
//
// ──────────────────────────────────────────────────────────────────────────

export {
  DockerSandbox,
  SandboxPool,
  type SandboxConfig,
  type SandboxResult,
} from "./docker-sandbox.js";

export {
  DEFAULT_RESOURCE_LIMITS,
  ResourceLimitBreachError,
  InMemoryBreachCounter,
  defaultBreachCounter,
  resolveLimits,
  limitsToDocker,
  enforceWallClock,
  isResourceLimitBreach,
  type ResourceLimits,
  type LimitBreachKind,
  type BreachCounter,
  type EnforceWallClockOptions,
} from "./limits.js";

export {
  SandboxSelector,
  InProcessRuntime,
  FakeRuntime,
  createSelector,
  marshal,
  unmarshal,
  type SandboxRuntime,
  type SandboxExecutionSpec,
  type SandboxExecutionResult,
  type IsolationKind,
  type SandboxSelectorOptions,
  type ExecuteOptions,
} from "./isolation.js";

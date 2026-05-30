import { z } from 'zod';
import type { Logger } from 'pino';

/**
 * Issue #526 — Pluggable orchestration strategies.
 *
 * A small, pure framework for swapping the agent's reasoning policy. A strategy
 * inspects a {@link StepContext} (the loop state so far) and decides the shape
 * of the next action: think, act (call a tool), reflect, or finish. The
 * decision is *advisory* — it never executes anything. All side-effecting
 * behaviour (model calls, tool selection) is supplied by injected hooks so this
 * module stays deterministic and testable.
 *
 * Three reference strategies are provided:
 *   - ReAct            — interleave reasoning and acting (Yao et al.).
 *   - Plan-and-Solve   — plan up front, then execute the plan step by step.
 *   - Reflexion        — act, then self-reflect on failures before retrying.
 *
 * A {@link StrategyRegistry} maps names to strategies for runtime selection.
 */

// ─── Action shapes ────────────────────────────────────────────────────────────

export const StrategyActionKindSchema = z.enum(['think', 'act', 'reflect', 'finish']);
export type StrategyActionKind = z.infer<typeof StrategyActionKindSchema>;

/**
 * The next action a strategy recommends. This is a description, not an
 * executable: the runtime maps it onto real model/tool calls.
 */
export interface StrategyAction {
  kind: StrategyActionKind;
  /** Free-form rationale for the recommendation (for logging / traces). */
  rationale: string;
  /** When kind is 'act', the suggested tool to invoke (if the strategy picked one). */
  tool?: string;
  /** When kind is 'finish', the reason the strategy considers the run complete. */
  finishReason?: 'goal-met' | 'max-steps' | 'no-progress' | 'plan-complete';
  /** Strategy-specific structured hints (e.g. the plan, the reflection text). */
  metadata?: Record<string, unknown>;
}

/** One recorded step of the agent loop, fed back to the strategy next turn. */
export interface StrategyStep {
  /** The action that was taken (mirrors a prior {@link StrategyAction}). */
  kind: StrategyActionKind;
  /** Whether the step is considered to have succeeded. */
  success: boolean;
  /** Optional tool that was used. */
  tool?: string;
  /** Optional textual observation/result of the step. */
  observation?: string;
}

/** Read-only context handed to a strategy each turn. */
export interface StepContext {
  /** The overall goal the agent is pursuing. */
  goal: string;
  /** Completed steps so far, in order. */
  history: StrategyStep[];
  /** Current loop iteration (0-based). */
  iteration: number;
  /** Hard cap on iterations; strategies should finish before exceeding it. */
  maxIterations: number;
  /** Tools available to the agent this turn. */
  availableTools: string[];
}

/**
 * Hooks injected into strategies so they remain pure. Each is optional and
 * deterministic from the caller's perspective; strategies call them rather than
 * embedding policy.
 */
export interface StrategyHooks {
  /** Returns true when the goal is considered satisfied given the context. */
  isGoalMet?: (ctx: StepContext) => boolean;
  /** Chooses a tool to act with; returns undefined to defer to pure reasoning. */
  selectTool?: (ctx: StepContext) => string | undefined;
  /** Produces a reflection string from the (failed) context. */
  reflect?: (ctx: StepContext) => string;
}

// ─── Strategy interface + registry ─────────────────────────────────────────────

export interface OrchestrationStrategy {
  /** Stable, unique strategy name. */
  readonly name: string;
  /** One-line human description. */
  readonly description: string;
  /**
   * Decide the next action given the current step context. Pure and
   * deterministic for a fixed context + hooks.
   */
  decide(ctx: StepContext, hooks?: StrategyHooks): StrategyAction;
}

/** Registry mapping strategy names to implementations. */
export class StrategyRegistry {
  private readonly strategies = new Map<string, OrchestrationStrategy>();

  constructor(initial: OrchestrationStrategy[] = [], private readonly logger?: Logger) {
    for (const s of initial) this.register(s);
  }

  register(strategy: OrchestrationStrategy): this {
    if (this.strategies.has(strategy.name)) {
      throw new Error(`orchestration strategy already registered: ${strategy.name}`);
    }
    this.strategies.set(strategy.name, strategy);
    this.logger?.debug({ strategy: strategy.name }, 'registered orchestration strategy');
    return this;
  }

  get(name: string): OrchestrationStrategy | undefined {
    return this.strategies.get(name);
  }

  /** Get a strategy or throw if missing. */
  require(name: string): OrchestrationStrategy {
    const s = this.strategies.get(name);
    if (!s) throw new Error(`unknown orchestration strategy: ${name}`);
    return s;
  }

  has(name: string): boolean {
    return this.strategies.has(name);
  }

  list(): OrchestrationStrategy[] {
    return [...this.strategies.values()];
  }

  names(): string[] {
    return [...this.strategies.keys()];
  }
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

function lastStep(ctx: StepContext): StrategyStep | undefined {
  return ctx.history[ctx.history.length - 1];
}

function outOfBudget(ctx: StepContext): boolean {
  return ctx.iteration >= ctx.maxIterations;
}

// ─── ReAct ─────────────────────────────────────────────────────────────────────

/**
 * ReAct: alternate a reasoning ("think") step with an acting ("act") step.
 * Finishes when the goal is met or iterations are exhausted.
 */
export class ReActStrategy implements OrchestrationStrategy {
  readonly name = 'react';
  readonly description = 'Interleave reasoning and acting (think -> act -> observe).';

  decide(ctx: StepContext, hooks: StrategyHooks = {}): StrategyAction {
    if (hooks.isGoalMet?.(ctx)) {
      return { kind: 'finish', rationale: 'goal satisfied', finishReason: 'goal-met' };
    }
    if (outOfBudget(ctx)) {
      return { kind: 'finish', rationale: 'iteration budget exhausted', finishReason: 'max-steps' };
    }

    const prev = lastStep(ctx);
    // After a think (or at the very start), act. After an act/observe, think.
    if (!prev || prev.kind === 'think') {
      const tool = hooks.selectTool?.(ctx);
      if (tool) {
        return { kind: 'act', rationale: `acting on reasoning using ${tool}`, tool };
      }
      // No tool available — reason once more then expect to finish.
      return { kind: 'think', rationale: 'no tool selected; continue reasoning' };
    }
    return { kind: 'think', rationale: 'reflect on latest observation before next action' };
  }
}

// ─── Plan-and-Solve ──────────────────────────────────────────────────────────

/**
 * Plan-and-Solve: produce a plan on the first turn (a single 'think' carrying
 * the plan in metadata), then act once per remaining plan step, finishing when
 * the plan is complete or the goal is met.
 */
export class PlanAndSolveStrategy implements OrchestrationStrategy {
  readonly name = 'plan-and-solve';
  readonly description = 'Plan the full approach up front, then execute step by step.';

  constructor(private readonly planner?: (ctx: StepContext) => string[]) {}

  decide(ctx: StepContext, hooks: StrategyHooks = {}): StrategyAction {
    if (hooks.isGoalMet?.(ctx)) {
      return { kind: 'finish', rationale: 'goal satisfied', finishReason: 'goal-met' };
    }

    const prev = lastStep(ctx);
    if (!prev) {
      const plan = this.planner?.(ctx) ?? [`Achieve: ${ctx.goal}`];
      return {
        kind: 'think',
        rationale: 'devised an up-front plan',
        metadata: { plan, planSize: plan.length },
      };
    }

    if (outOfBudget(ctx)) {
      return { kind: 'finish', rationale: 'iteration budget exhausted', finishReason: 'max-steps' };
    }

    // Count how many act steps we've done; once we've matched the plan size, finish.
    // The plan is re-derived deterministically from the same planner/goal.
    const plan = this.planner?.(ctx) ?? [`Achieve: ${ctx.goal}`];
    const actsDone = ctx.history.filter((s) => s.kind === 'act').length;
    if (actsDone >= plan.length) {
      return { kind: 'finish', rationale: 'all plan steps executed', finishReason: 'plan-complete' };
    }

    const tool = hooks.selectTool?.(ctx);
    return {
      kind: 'act',
      rationale: `executing plan step ${actsDone + 1}/${plan.length}`,
      tool,
      metadata: { planStep: actsDone + 1, planSize: plan.length },
    };
  }
}

// ─── Reflexion ─────────────────────────────────────────────────────────────────

/**
 * Reflexion: act, and when an act step fails, insert a 'reflect' step that
 * captures a lesson (via the injected `reflect` hook) before retrying. Finishes
 * on goal-met or budget exhaustion.
 */
export class ReflexionStrategy implements OrchestrationStrategy {
  readonly name = 'reflexion';
  readonly description = 'Act, then self-reflect on failures before retrying.';

  constructor(private readonly maxReflections = 3) {}

  decide(ctx: StepContext, hooks: StrategyHooks = {}): StrategyAction {
    if (hooks.isGoalMet?.(ctx)) {
      return { kind: 'finish', rationale: 'goal satisfied', finishReason: 'goal-met' };
    }
    if (outOfBudget(ctx)) {
      return { kind: 'finish', rationale: 'iteration budget exhausted', finishReason: 'max-steps' };
    }

    const prev = lastStep(ctx);
    const reflections = ctx.history.filter((s) => s.kind === 'reflect').length;

    // A just-failed act triggers a reflection, up to the cap.
    if (prev && prev.kind === 'act' && !prev.success) {
      if (reflections >= this.maxReflections) {
        return {
          kind: 'finish',
          rationale: 'reflection budget exhausted without progress',
          finishReason: 'no-progress',
        };
      }
      const reflection = hooks.reflect?.(ctx) ?? `Previous action with ${prev.tool ?? 'tool'} failed; adjust approach.`;
      return {
        kind: 'reflect',
        rationale: 'self-reflect on the failed action',
        metadata: { reflection, reflectionIndex: reflections + 1 },
      };
    }

    const tool = hooks.selectTool?.(ctx);
    return {
      kind: 'act',
      rationale: prev?.kind === 'reflect' ? 'retry after reflection' : 'attempt the task',
      tool,
    };
  }
}

// ─── Defaults ──────────────────────────────────────────────────────────────────

/** Construct a registry pre-populated with the three reference strategies. */
export function createDefaultStrategyRegistry(logger?: Logger): StrategyRegistry {
  return new StrategyRegistry(
    [new ReActStrategy(), new PlanAndSolveStrategy(), new ReflexionStrategy()],
    logger,
  );
}

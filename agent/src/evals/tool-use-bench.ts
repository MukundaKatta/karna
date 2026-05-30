// ─── Tool-Use Accuracy Benchmark (#571) ───────────────────────────────────────
//
// Score how well an agent selects tools and constructs their arguments against
// labeled scenarios. Two metrics:
//   - tool-selection accuracy: did the agent call the expected tool?
//   - argument validity:       were the produced arguments valid & correct?
//
// The agent under test is injected as `ToolUseRunner`; argument validation is
// pluggable so callers can use Zod, JSON-schema, or custom checks.
//
// ──────────────────────────────────────────────────────────────────────────────

/** A single tool invocation the agent produced. */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** A labeled scenario: a prompt and the expected tool call. */
export interface ToolUseScenario {
  id: string;
  description?: string;
  /** The user prompt presented to the agent. */
  prompt: string;
  /** Name of the tool that *should* be selected. */
  expectedTool: string;
  /** Expected argument key/values (subset match by default). */
  expectedArguments?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** The agent under test: prompt -> the tool calls it would make. */
export type ToolUseRunner = (
  scenario: ToolUseScenario,
) => ToolCall[] | Promise<ToolCall[]>;

/**
 * Validates a produced tool call's arguments for a scenario. Returns true when
 * the arguments are acceptable. Injected so the harness is schema-agnostic.
 */
export type ArgumentValidator = (
  scenario: ToolUseScenario,
  call: ToolCall,
) => boolean;

/** Per-scenario result. */
export interface ToolUseScenarioResult {
  scenarioId: string;
  /** True when a call to `expectedTool` was made. */
  toolSelected: boolean;
  /** True when the selected tool's arguments validated. */
  argumentsValid: boolean;
  /** The actual tool names the agent called. */
  actualTools: string[];
  error?: string;
}

/** Aggregate benchmark report. */
export interface ToolUseReport {
  name: string;
  total: number;
  /** Fraction of scenarios where the expected tool was selected, in [0,1]. */
  toolSelectionAccuracy: number;
  /**
   * Fraction of scenarios where, given the tool was selected, the arguments
   * validated. Computed over the scenarios where the tool was selected.
   */
  argumentValidity: number;
  /** Fraction where BOTH tool + args were correct, in [0,1]. */
  exactAccuracy: number;
  results: ToolUseScenarioResult[];
}

/**
 * Default argument validator: every key in `scenario.expectedArguments` must be
 * present in the call with a deeply-equal value (subset match). Extra args are
 * permitted. If a scenario has no `expectedArguments`, any args are valid.
 */
export const subsetArgumentValidator: ArgumentValidator = (scenario, call) => {
  const expected = scenario.expectedArguments;
  if (!expected) return true;
  for (const [k, v] of Object.entries(expected)) {
    if (!(k in call.arguments)) return false;
    if (JSON.stringify(call.arguments[k]) !== JSON.stringify(v)) return false;
  }
  return true;
};

/**
 * Run the tool-use benchmark over a set of labeled scenarios.
 *
 * @param validator Defaults to {@link subsetArgumentValidator}.
 */
export async function runToolUseBench(
  name: string,
  scenarios: ReadonlyArray<ToolUseScenario>,
  runner: ToolUseRunner,
  validator: ArgumentValidator = subsetArgumentValidator,
): Promise<ToolUseReport> {
  const results: ToolUseScenarioResult[] = [];

  for (const scenario of scenarios) {
    try {
      const calls = await runner(scenario);
      const actualTools = calls.map((c) => c.name);
      const matching = calls.find((c) => c.name === scenario.expectedTool);
      const toolSelected = matching !== undefined;
      const argumentsValid = toolSelected
        ? validator(scenario, matching as ToolCall)
        : false;
      results.push({
        scenarioId: scenario.id,
        toolSelected,
        argumentsValid,
        actualTools,
      });
    } catch (err) {
      results.push({
        scenarioId: scenario.id,
        toolSelected: false,
        argumentsValid: false,
        actualTools: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const total = results.length;
  const selectedCount = results.filter((r) => r.toolSelected).length;
  const validArgCount = results.filter((r) => r.toolSelected && r.argumentsValid).length;
  const exactCount = results.filter((r) => r.toolSelected && r.argumentsValid).length;

  return {
    name,
    total,
    toolSelectionAccuracy: total === 0 ? 0 : selectedCount / total,
    argumentValidity: selectedCount === 0 ? 0 : validArgCount / selectedCount,
    exactAccuracy: total === 0 ? 0 : exactCount / total,
    results,
  };
}

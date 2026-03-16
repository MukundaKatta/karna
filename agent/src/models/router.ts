// ─── Model Router ──────────────────────────────────────────────────────────

import pino from "pino";
import type { ModelProvider } from "./provider.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";

const logger = pino({ name: "model-router" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentConfig {
  id: string;
  name: string;
  defaultModel?: string;
  defaultProvider?: string;
  /** Optional overrides per complexity tier. */
  modelOverrides?: {
    simple?: string;
    moderate?: string;
    complex?: string;
  };
}

export interface RouteResult {
  provider: ModelProvider;
  model: string;
  complexity: ComplexityTier;
}

export type ComplexityTier = "simple" | "moderate" | "complex";

// ─── Complexity Thresholds ──────────────────────────────────────────────────

const SIMPLE_MAX_LENGTH = 200;
const MODERATE_MAX_LENGTH = 1000;
const TOOL_MENTION_PATTERNS = [
  /\b(search|find|look up|execute|run|create|delete|write|read)\b/i,
  /\b(file|command|shell|api|database|query)\b/i,
];

// ─── Default Models ─────────────────────────────────────────────────────────

const DEFAULT_MODELS: Record<ComplexityTier, string> = {
  simple: "claude-haiku-4-20250514",
  moderate: "claude-sonnet-4-20250514",
  complex: "claude-sonnet-4-20250514",
};

// ─── Provider Cache ─────────────────────────────────────────────────────────

const providerCache = new Map<string, ModelProvider>();

function getProvider(name: string): ModelProvider {
  const cached = providerCache.get(name);
  if (cached) return cached;

  let provider: ModelProvider;
  switch (name) {
    case "anthropic":
      provider = new AnthropicProvider();
      break;
    case "openai":
      provider = new OpenAIProvider();
      break;
    default:
      throw new Error(`Unknown model provider: ${name}`);
  }

  providerCache.set(name, provider);
  return provider;
}

/**
 * Infer the provider name from a model identifier.
 */
function inferProvider(model: string): string {
  if (model.startsWith("claude") || model.startsWith("anthropic")) return "anthropic";
  if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3")) return "openai";
  // Default to anthropic
  return "anthropic";
}

// ─── Complexity Assessment ──────────────────────────────────────────────────

/**
 * Assess the complexity of a user message based on heuristics:
 * - Message length
 * - Presence of tool-related keywords
 * - Number of questions or tasks
 * - Presence of code blocks
 */
export function assessComplexity(message: string): ComplexityTier {
  let score = 0;

  // Length scoring
  if (message.length > MODERATE_MAX_LENGTH) {
    score += 2;
  } else if (message.length > SIMPLE_MAX_LENGTH) {
    score += 1;
  }

  // Tool mention scoring
  const toolMatches = TOOL_MENTION_PATTERNS.filter((p) => p.test(message));
  score += toolMatches.length;

  // Multi-part request scoring (multiple questions or steps)
  const questionMarks = (message.match(/\?/g) ?? []).length;
  const numberedSteps = (message.match(/^\s*\d+[\.\)]/gm) ?? []).length;
  if (questionMarks > 2 || numberedSteps > 2) score += 2;
  else if (questionMarks > 0 || numberedSteps > 0) score += 1;

  // Code block scoring
  if (message.includes("```")) score += 1;

  // Classify
  if (score >= 4) return "complex";
  if (score >= 2) return "moderate";
  return "simple";
}

// ─── Route Function ─────────────────────────────────────────────────────────

/**
 * Route a task to the appropriate model and provider based on complexity.
 *
 * Priority:
 * 1. Agent-level model override for the complexity tier
 * 2. Agent default model
 * 3. Global default for the complexity tier
 */
export function routeModel(message: string, agent?: AgentConfig): RouteResult {
  const complexity = assessComplexity(message);

  // Determine model
  let model: string;
  if (agent?.modelOverrides?.[complexity]) {
    model = agent.modelOverrides[complexity]!;
  } else if (agent?.defaultModel) {
    model = agent.defaultModel;
  } else {
    model = DEFAULT_MODELS[complexity];
  }

  // Determine provider
  const providerName = agent?.defaultProvider ?? inferProvider(model);
  const provider = getProvider(providerName);

  logger.debug(
    { complexity, model, provider: providerName, agentId: agent?.id },
    "Routed model"
  );

  return { provider, model, complexity };
}

/**
 * Clear the provider cache. Useful for testing or reconfiguration.
 */
export function clearProviderCache(): void {
  providerCache.clear();
}

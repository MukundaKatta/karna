// ─── Dynamic System Prompt Builder ─────────────────────────────────────────

import type { MemoryEntry } from "@karna/shared/types/memory.js";
import type { SkillMetadata } from "@karna/shared/types/skill.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentPersona {
  id: string;
  name: string;
  description?: string;
  personality?: string;
  instructions?: string;
  capabilities?: string[];
  constraints?: string[];
}

export interface SystemPromptParams {
  agent: AgentPersona;
  memories?: MemoryEntry[];
  skills?: SkillMetadata[];
  currentTime?: Date;
  sessionContext?: string;
  customInstructions?: string;
}

// ─── System Prompt Builder ──────────────────────────────────────────────────

/**
 * Build a dynamic system prompt incorporating the agent's persona,
 * relevant memories, available skills, and current context.
 */
export function buildSystemPrompt(params: SystemPromptParams): string {
  const { agent, memories, skills, currentTime, sessionContext, customInstructions } = params;
  const sections: string[] = [];

  // ─── Identity ───────────────────────────────────────────────────────────
  sections.push(buildIdentitySection(agent));

  // ─── Current Time ───────────────────────────────────────────────────────
  const time = currentTime ?? new Date();
  sections.push(`Current time: ${time.toISOString()}`);

  // ─── Session Context ────────────────────────────────────────────────────
  if (sessionContext) {
    sections.push(`## Session Context\n${sessionContext}`);
  }

  // ─── Memory Context ─────────────────────────────────────────────────────
  if (memories && memories.length > 0) {
    sections.push(buildMemorySection(memories));
  }

  // ─── Available Skills ───────────────────────────────────────────────────
  if (skills && skills.length > 0) {
    sections.push(buildSkillsSection(skills));
  }

  // ─── Constraints ────────────────────────────────────────────────────────
  if (agent.constraints && agent.constraints.length > 0) {
    sections.push(buildConstraintsSection(agent.constraints));
  }

  // ─── Custom Instructions ────────────────────────────────────────────────
  if (customInstructions) {
    sections.push(`## Additional Instructions\n${customInstructions}`);
  }

  // ─── Behavioral Guidelines ──────────────────────────────────────────────
  sections.push(buildGuidelinesSection());

  return sections.join("\n\n");
}

// ─── Section Builders ───────────────────────────────────────────────────────

function buildIdentitySection(agent: AgentPersona): string {
  const lines: string[] = [];

  lines.push(`## Identity`);
  lines.push(`You are ${agent.name}.`);

  if (agent.description) {
    lines.push(agent.description);
  }

  if (agent.personality) {
    lines.push(`\nPersonality: ${agent.personality}`);
  }

  if (agent.instructions) {
    lines.push(`\n${agent.instructions}`);
  }

  if (agent.capabilities && agent.capabilities.length > 0) {
    lines.push(`\nCapabilities:`);
    for (const cap of agent.capabilities) {
      lines.push(`- ${cap}`);
    }
  }

  return lines.join("\n");
}

function buildMemorySection(memories: MemoryEntry[]): string {
  const lines: string[] = [];
  lines.push("## Relevant Context from Memory");
  lines.push(
    "The following information was retrieved from your memory and may be relevant to the current conversation:"
  );
  lines.push("");

  for (const memory of memories) {
    const tags = memory.tags.length > 0 ? ` [${memory.tags.join(", ")}]` : "";
    const priority = memory.priority !== "normal" ? ` (${memory.priority} priority)` : "";
    const summary = memory.summary ?? memory.content;
    lines.push(`- ${summary}${tags}${priority}`);
  }

  return lines.join("\n");
}

function buildSkillsSection(skills: SkillMetadata[]): string {
  const lines: string[] = [];
  lines.push("## Available Skills");
  lines.push(
    "You have access to the following skills. Use them when they match the user's request:"
  );
  lines.push("");

  for (const skill of skills) {
    lines.push(`### ${skill.name} (${skill.id})`);
    lines.push(skill.description);

    if (skill.triggers.length > 0) {
      const triggerDescs = skill.triggers
        .map((t) => `${t.type}: "${t.value}"`)
        .join(", ");
      lines.push(`Triggers: ${triggerDescs}`);
    }

    if (skill.actions.length > 0) {
      lines.push("Actions:");
      for (const action of skill.actions) {
        lines.push(`  - ${action.name}: ${action.description}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

function buildConstraintsSection(constraints: string[]): string {
  const lines: string[] = [];
  lines.push("## Constraints");
  lines.push("You must follow these constraints:");
  for (const constraint of constraints) {
    lines.push(`- ${constraint}`);
  }
  return lines.join("\n");
}

function buildGuidelinesSection(): string {
  return [
    "## Behavioral Guidelines",
    "- Be helpful, accurate, and concise.",
    "- When using tools, explain what you are doing and why.",
    "- If a tool requires approval, explain the action to the user and wait for confirmation.",
    "- If you are unsure about something, ask for clarification rather than guessing.",
    "- When accessing files or running commands, respect the user's workspace and avoid destructive actions.",
    "- Cite sources when presenting information from web searches or memory.",
  ].join("\n");
}

import type { ChatTool } from "../models/provider.js";

const DEFAULT_MAX_TOOLS = 18;

const TOOL_KEYWORDS: Array<{ pattern: RegExp; tokens: string[] }> = [
  { pattern: /\b(file|folder|directory|read|write|delete|move|rename|search files?)\b/i, tokens: ["file", "apply_patch"] },
  { pattern: /\b(web|search|current|latest|news|price|availability|url|website|page|image)\b/i, tokens: ["web", "browser"] },
  { pattern: /\b(github|repo|pull request|pr\b|issue|branch|commit|ci|check)\b/i, tokens: ["github"] },
  { pattern: /\b(email|gmail|mail|inbox|draft)\b/i, tokens: ["email"] },
  { pattern: /\b(calendar|meeting|event|schedule)\b/i, tokens: ["calendar"] },
  { pattern: /\b(note|notes|remember|tag|pin)\b/i, tokens: ["note", "memory"] },
  { pattern: /\b(reminder|task|todo|follow up|snooze)\b/i, tokens: ["reminder"] },
  { pattern: /\b(screenshot|screen|window|ocr|capture)\b/i, tokens: ["screenshot"] },
  { pattern: /\b(slack|discord|telegram|sms|message|send)\b/i, tokens: ["message", "slack", "discord", "telegram", "sms"] },
  { pattern: /\b(calculate|math|convert|currency|unit)\b/i, tokens: ["calculate", "convert", "currency"] },
  { pattern: /\b(voice|audio|speak|transcribe)\b/i, tokens: ["voice"] },
];

export interface ToolSelectionResult {
  tools: ChatTool[];
  pruned: boolean;
  selectedToolNames: string[];
  droppedToolCount: number;
}

export function selectRelevantChatTools(
  message: string,
  tools: ChatTool[],
  maxTools = resolveMaxTools(),
): ToolSelectionResult {
  if (tools.length <= maxTools) {
    return {
      tools,
      pruned: false,
      selectedToolNames: tools.map((tool) => tool.name),
      droppedToolCount: 0,
    };
  }

  const query = message.toLowerCase();
  const wantedTokens = new Set<string>();
  for (const rule of TOOL_KEYWORDS) {
    if (rule.pattern.test(message)) {
      for (const token of rule.tokens) {
        wantedTokens.add(token);
      }
    }
  }

  const scored = tools.map((tool, index) => ({
    tool,
    index,
    score: scoreTool(query, tool, wantedTokens),
  }));

  const selected = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxTools)
    .map((item) => item.tool);

  const fallback =
    selected.length > 0
      ? selected
      : scored
          .sort((a, b) => a.index - b.index)
          .slice(0, Math.min(maxTools, tools.length))
          .map((item) => item.tool);

  return {
    tools: fallback,
    pruned: true,
    selectedToolNames: fallback.map((tool) => tool.name),
    droppedToolCount: Math.max(0, tools.length - fallback.length),
  };
}

function scoreTool(
  query: string,
  tool: ChatTool,
  wantedTokens: Set<string>,
): number {
  const haystack = `${tool.name} ${tool.description}`.toLowerCase();
  let score = 0;

  for (const token of wantedTokens) {
    if (haystack.includes(token)) {
      score += 5;
    }
  }

  for (const word of query.split(/[^a-z0-9_]+/).filter((part) => part.length > 2)) {
    if (haystack.includes(word)) {
      score += 1;
    }
  }

  return score;
}

function resolveMaxTools(): number {
  const raw = process.env["KARNA_MAX_CONTEXT_TOOLS"] ?? process.env["MAX_CONTEXT_TOOLS"];
  const parsed = raw ? Number(raw) : DEFAULT_MAX_TOOLS;
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_MAX_TOOLS;
  }
  return Math.min(parsed, 50);
}

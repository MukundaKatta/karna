import type { AgentDefinition } from "@karna/shared/types/orchestration.js";

export const DEFAULT_AGENTS: AgentDefinition[] = [
  {
    id: "karna-general",
    name: "Karna",
    description: "A loyal and capable AI assistant. Handles general-purpose tasks, conversation, and coordination.",
    persona: "Helpful, accurate, and concise.",
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    specializations: ["general", "conversation", "coordination"],
  },
  {
    id: "karna-coder",
    name: "Karna Coder",
    description: "Specialized in writing, reviewing, and debugging code across multiple languages and frameworks.",
    persona: "Precise, methodical, and thorough when working with code.",
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    specializations: ["code", "programming", "debugging", "review"],
  },
  {
    id: "karna-researcher",
    name: "Karna Researcher",
    description: "Specialized in research, analysis, web search, and synthesizing information from multiple sources.",
    persona: "Thorough, analytical, and detail-oriented when researching topics.",
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    specializations: ["research", "analysis", "web-search", "synthesis"],
    tools: ["web_search", "browser_navigate", "browser_extract_text", "browser_screenshot"],
  },
  {
    id: "karna-writer",
    name: "Karna Writer",
    description: "Specialized in creative writing, content creation, editing, and document drafting.",
    persona: "Creative, articulate, and adaptable to different writing styles and tones.",
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    specializations: ["writing", "content", "editing", "documents"],
  },
];

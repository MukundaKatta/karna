import { describe, it, expect } from "vitest";
import { buildSystemPrompt, type AgentPersona } from "../../agent/src/context/system-prompt.js";

describe("System Prompt Builder - Extended", () => {
  const baseAgent: AgentPersona = {
    id: "agent-1",
    name: "TestAgent",
    description: "A test agent",
  };

  it("produces non-empty output with minimal config", () => {
    const prompt = buildSystemPrompt({ agent: baseAgent });
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain("TestAgent");
  });

  it("includes guidelines section always", () => {
    const prompt = buildSystemPrompt({ agent: baseAgent });
    expect(prompt).toContain("Behavioral Guidelines");
    expect(prompt).toContain("helpful, accurate, and concise");
  });

  it("includes agent instructions when provided", () => {
    const agent: AgentPersona = {
      ...baseAgent,
      instructions: "Always respond in JSON format.",
    };
    const prompt = buildSystemPrompt({ agent });
    expect(prompt).toContain("Always respond in JSON format.");
  });

  it("handles empty memories array", () => {
    const prompt = buildSystemPrompt({ agent: baseAgent, memories: [] });
    expect(prompt).not.toContain("Relevant Context from Memory");
  });

  it("handles empty skills array", () => {
    const prompt = buildSystemPrompt({ agent: baseAgent, skills: [] });
    expect(prompt).not.toContain("Available Skills");
  });

  it("includes session context", () => {
    const prompt = buildSystemPrompt({
      agent: baseAgent,
      sessionContext: "User is on the Telegram channel",
    });
    expect(prompt).toContain("Session Context");
    expect(prompt).toContain("Telegram channel");
  });

  it("combines all sections", () => {
    const prompt = buildSystemPrompt({
      agent: {
        ...baseAgent,
        personality: "Friendly",
        capabilities: ["Search", "Code"],
        constraints: ["No PII"],
      },
      memories: [
        {
          id: "m1",
          agentId: "agent-1",
          content: "User likes TypeScript",
          summary: "User likes TypeScript",
          source: "conversation" as const,
          priority: "high" as const,
          tags: ["preference"],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      skills: [
        {
          id: "code-review",
          name: "Code Review",
          description: "Reviews code",
          version: "1.0.0",
          triggers: [{ type: "keyword" as const, value: "review" }],
          actions: [{ name: "review", description: "Analyze code" }],
        },
      ],
      customInstructions: "Be extra verbose",
    });

    expect(prompt).toContain("Identity");
    expect(prompt).toContain("Friendly");
    expect(prompt).toContain("Search");
    expect(prompt).toContain("No PII");
    expect(prompt).toContain("User likes TypeScript");
    expect(prompt).toContain("high priority");
    expect(prompt).toContain("Code Review");
    expect(prompt).toContain("Additional Instructions");
    expect(prompt).toContain("Be extra verbose");
    expect(prompt).toContain("Behavioral Guidelines");
  });

  it("includes memory tags", () => {
    const prompt = buildSystemPrompt({
      agent: baseAgent,
      memories: [
        {
          id: "m1",
          agentId: "agent-1",
          content: "Fact",
          summary: "Fact",
          source: "system" as const,
          priority: "normal" as const,
          tags: ["tag1", "tag2"],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    });
    expect(prompt).toContain("tag1");
    expect(prompt).toContain("tag2");
  });

  it("includes skill triggers", () => {
    const prompt = buildSystemPrompt({
      agent: baseAgent,
      skills: [
        {
          id: "news",
          name: "News",
          description: "Fetches news",
          version: "1.0.0",
          triggers: [
            { type: "keyword" as const, value: "news" },
            { type: "keyword" as const, value: "headlines" },
          ],
          actions: [],
        },
      ],
    });
    expect(prompt).toContain('keyword: "news"');
    expect(prompt).toContain('keyword: "headlines"');
  });
});

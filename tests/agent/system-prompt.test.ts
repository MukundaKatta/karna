import { describe, it, expect } from "vitest";
import { buildSystemPrompt, type AgentPersona } from "../../agent/src/context/system-prompt.js";

describe("System Prompt Builder", () => {
  const baseAgent: AgentPersona = {
    id: "agent-1",
    name: "Karna",
    description: "A loyal AI assistant",
    personality: "Helpful and precise",
  };

  it("includes agent identity", () => {
    const prompt = buildSystemPrompt({ agent: baseAgent });
    expect(prompt).toContain("Karna");
    expect(prompt).toContain("A loyal AI assistant");
    expect(prompt).toContain("Helpful and precise");
  });

  it("includes current time", () => {
    const fixedTime = new Date("2026-03-26T12:00:00Z");
    const prompt = buildSystemPrompt({ agent: baseAgent, currentTime: fixedTime });
    expect(prompt).toContain("2026-03-26");
  });

  it("includes memory context when provided", () => {
    const memories = [
      {
        id: "mem-1",
        agentId: "agent-1",
        content: "User prefers concise responses",
        summary: "User prefers concise responses",
        source: "conversation" as const,
        priority: "normal" as const,
        tags: ["preference"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
    const prompt = buildSystemPrompt({ agent: baseAgent, memories });
    expect(prompt).toContain("Relevant Context from Memory");
    expect(prompt).toContain("User prefers concise responses");
    expect(prompt).toContain("preference");
  });

  it("includes skills when provided", () => {
    const skills = [
      {
        id: "news-digest",
        name: "News Digest",
        description: "Fetch and summarize news",
        version: "1.0.0",
        triggers: [{ type: "keyword" as const, value: "news" }],
        actions: [{ name: "fetch", description: "Fetch latest news" }],
      },
    ];
    const prompt = buildSystemPrompt({ agent: baseAgent, skills });
    expect(prompt).toContain("Available Skills");
    expect(prompt).toContain("News Digest");
    expect(prompt).toContain("Fetch and summarize news");
  });

  it("includes constraints when provided", () => {
    const agent: AgentPersona = {
      ...baseAgent,
      constraints: ["Never share sensitive data", "Always cite sources"],
    };
    const prompt = buildSystemPrompt({ agent });
    expect(prompt).toContain("Constraints");
    expect(prompt).toContain("Never share sensitive data");
    expect(prompt).toContain("Always cite sources");
  });

  it("includes custom instructions", () => {
    const prompt = buildSystemPrompt({
      agent: baseAgent,
      customInstructions: "Respond only in JSON format",
    });
    expect(prompt).toContain("Additional Instructions");
    expect(prompt).toContain("Respond only in JSON format");
  });

  it("includes behavioral guidelines", () => {
    const prompt = buildSystemPrompt({ agent: baseAgent });
    expect(prompt).toContain("Behavioral Guidelines");
    expect(prompt).toContain("helpful, accurate, and concise");
  });

  it("includes capabilities when provided", () => {
    const agent: AgentPersona = {
      ...baseAgent,
      capabilities: ["Web search", "File management", "Code execution"],
    };
    const prompt = buildSystemPrompt({ agent });
    expect(prompt).toContain("Capabilities");
    expect(prompt).toContain("Web search");
    expect(prompt).toContain("Code execution");
  });
});

import { afterEach, describe, expect, it } from "vitest";

import { selectRelevantChatTools } from "../../agent/src/tools/selection.js";
import type { ChatTool } from "../../agent/src/models/provider.js";

const originalMaxContextTools = process.env["MAX_CONTEXT_TOOLS"];
const originalKarnaMaxContextTools = process.env["KARNA_MAX_CONTEXT_TOOLS"];

afterEach(() => {
  restoreEnv("MAX_CONTEXT_TOOLS", originalMaxContextTools);
  restoreEnv("KARNA_MAX_CONTEXT_TOOLS", originalKarnaMaxContextTools);
});

describe("tool selection", () => {
  it("keeps all tools when the registry fits the budget", () => {
    const tools = makeTools(["file_read", "web_search"]);

    const selection = selectRelevantChatTools("read package.json", tools, 3);

    expect(selection.pruned).toBe(false);
    expect(selection.tools.map((tool) => tool.name)).toEqual([
      "file_read",
      "web_search",
    ]);
  });

  it("prunes large registries to tools relevant to the current query", () => {
    const tools = makeTools([
      "file_read",
      "file_write",
      "web_search",
      "github_list_issues",
      "calendar_list_events",
      "email_send",
    ]);

    const selection = selectRelevantChatTools(
      "Search the repo issues and check the pull request",
      tools,
      2,
    );

    expect(selection.pruned).toBe(true);
    expect(selection.droppedToolCount).toBe(4);
    expect(selection.tools.map((tool) => tool.name).sort()).toEqual([
      "github_list_issues",
      "web_search",
    ].sort());
  });

  it("uses MAX_CONTEXT_TOOLS as the default budget", () => {
    process.env["MAX_CONTEXT_TOOLS"] = "1";

    const selection = selectRelevantChatTools(
      "calculate exchange rate",
      makeTools(["calculate", "file_read"]),
    );

    expect(selection.tools.map((tool) => tool.name)).toEqual(["calculate"]);
  });
});

function makeTools(names: string[]): ChatTool[] {
  return names.map((name) => ({
    name,
    description: `${name.replace(/_/g, " ")} tool`,
    parameters: { type: "object", properties: {} },
  }));
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

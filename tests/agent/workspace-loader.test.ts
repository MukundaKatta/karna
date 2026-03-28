import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadWorkspaceConfig, workspaceToPromptSections, parseHeartbeatTasks } from "../../agent/src/workspace/loader.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Workspace Config Loader", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "karna-workspace-test-"));
  });

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true }); } catch {}
  });

  it("loads empty workspace", () => {
    const config = loadWorkspaceConfig(tempDir);
    expect(config.loadedFiles).toHaveLength(0);
    expect(config.soul).toBeNull();
    expect(config.workspacePath).toBe(tempDir);
  });

  it("loads SOUL.md", () => {
    writeFileSync(join(tempDir, "SOUL.md"), "You are a helpful assistant.");
    const config = loadWorkspaceConfig(tempDir);
    expect(config.soul).toBe("You are a helpful assistant.");
    expect(config.loadedFiles).toContain("SOUL.md");
  });

  it("loads multiple config files", () => {
    writeFileSync(join(tempDir, "SOUL.md"), "Personality here");
    writeFileSync(join(tempDir, "USER.md"), "User prefers concise answers");
    writeFileSync(join(tempDir, "TOOLS.md"), "Always prefer web_search");
    const config = loadWorkspaceConfig(tempDir);
    expect(config.loadedFiles).toHaveLength(3);
    expect(config.soul).toBe("Personality here");
    expect(config.user).toBe("User prefers concise answers");
    expect(config.tools).toBe("Always prefer web_search");
  });

  it("skips empty files", () => {
    writeFileSync(join(tempDir, "SOUL.md"), "");
    writeFileSync(join(tempDir, "USER.md"), "   ");
    const config = loadWorkspaceConfig(tempDir);
    expect(config.loadedFiles).toHaveLength(0);
  });

  it("loads all 8 config files", () => {
    for (const name of ["SOUL.md", "AGENTS.md", "USER.md", "TOOLS.md", "IDENTITY.md", "HEARTBEAT.md", "BOOTSTRAP.md", "MEMORY.md"]) {
      writeFileSync(join(tempDir, name), `Content of ${name}`);
    }
    const config = loadWorkspaceConfig(tempDir);
    expect(config.loadedFiles).toHaveLength(8);
    expect(config.soul).toContain("SOUL.md");
    expect(config.agents).toContain("AGENTS.md");
    expect(config.heartbeat).toContain("HEARTBEAT.md");
    expect(config.bootstrap).toContain("BOOTSTRAP.md");
    expect(config.memory).toContain("MEMORY.md");
  });

  describe("workspaceToPromptSections", () => {
    it("converts config to prompt sections", () => {
      writeFileSync(join(tempDir, "SOUL.md"), "Be friendly and helpful");
      writeFileSync(join(tempDir, "USER.md"), "User is a developer");
      const config = loadWorkspaceConfig(tempDir);
      const prompt = workspaceToPromptSections(config);
      expect(prompt).toContain("Personality & Soul");
      expect(prompt).toContain("Be friendly and helpful");
      expect(prompt).toContain("User Context");
      expect(prompt).toContain("User is a developer");
    });

    it("omits empty sections", () => {
      writeFileSync(join(tempDir, "SOUL.md"), "Only soul");
      const config = loadWorkspaceConfig(tempDir);
      const prompt = workspaceToPromptSections(config);
      expect(prompt).toContain("Personality & Soul");
      expect(prompt).not.toContain("User Context");
      expect(prompt).not.toContain("Operating Instructions");
    });
  });

  describe("parseHeartbeatTasks", () => {
    it("parses simple task list", () => {
      const heartbeat = "- Check emails\n- Review PRs\n- Update dashboard";
      const tasks = parseHeartbeatTasks(heartbeat);
      expect(tasks).toHaveLength(3);
      expect(tasks[0]!.description).toBe("Check emails");
    });

    it("parses tasks with schedule brackets", () => {
      const heartbeat = "- [every 4h] Check emails\n- [daily 9am] Send standup\n- Review PRs";
      const tasks = parseHeartbeatTasks(heartbeat);
      expect(tasks).toHaveLength(3);
      expect(tasks[0]!.schedule).toBe("every 4h");
      expect(tasks[0]!.description).toBe("Check emails");
      expect(tasks[2]!.schedule).toBeUndefined();
    });

    it("supports * bullet points", () => {
      const heartbeat = "* Task one\n* Task two";
      const tasks = parseHeartbeatTasks(heartbeat);
      expect(tasks).toHaveLength(2);
    });

    it("ignores non-list lines", () => {
      const heartbeat = "# Heartbeat\n\nSome description\n\n- Actual task";
      const tasks = parseHeartbeatTasks(heartbeat);
      expect(tasks).toHaveLength(1);
    });
  });
});

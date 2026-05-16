import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDiscordResponseEmbed,
  buildDiscordToolApprovalEmbed,
  buildDiscordToolResultEmbed,
} from "../../channels/discord/src/adapter.js";
import { getDiscordSlashCommandNames } from "../../channels/discord/src/slash-commands.js";
import type {
  ToolApprovalRequestedMessage,
  ToolResultMessage,
} from "../../packages/shared/src/types/protocol.js";

const ROOT = process.cwd();

describe("Discord slash commands", () => {
  it("registers the public command names on first startup", () => {
    expect(getDiscordSlashCommandNames()).toEqual(
      expect.arrayContaining([
        "ask",
        "remember",
        "skills",
        "chat",
        "status",
        "help",
        "reset",
      ]),
    );
  });

  it("starts slash command registration before Discord login and keeps it idempotent", () => {
    const source = readFileSync(
      join(ROOT, "channels/discord/src/adapter.ts"),
      "utf-8",
    );

    expect(source).toContain("await this.ensureSlashCommandsRegistered();");
    expect(
      source.indexOf("await this.ensureSlashCommandsRegistered();"),
    ).toBeLessThan(
      source.indexOf("await this.client.login(this.config.botToken);"),
    );
    expect(source).toContain("private ensureSlashCommandsRegistered()");
    expect(source).toContain("if (!this.slashCommandRegistration)");
  });

  it("formats agent responses and memory recall as Discord embeds", () => {
    const embed = buildDiscordResponseEmbed(
      "I remember that your preferred deploy target is Vercel.",
      "stop",
    ).toJSON();

    expect(embed.color).toBe(0x2ecc71);
    expect(embed.footer?.text).toBe("Memory context included");
  });

  it("formats tool results as embed fields", () => {
    const embed = buildDiscordToolResultEmbed({
      id: "tool-result-1",
      type: "tool.result",
      timestamp: Date.now(),
      sessionId: "session-1",
      payload: {
        toolCallId: "call-1",
        toolName: "web_search",
        result: { title: "Result" },
        isError: false,
        durationMs: 12,
      },
    } satisfies ToolResultMessage).toJSON();

    expect(embed.title).toBe("Tool Result");
    expect(embed.fields?.map((field) => field.name)).toEqual(
      expect.arrayContaining(["Tool", "Status", "Duration", "Result"]),
    );
  });

  it("adds Discord controls for approvals and skill selection", () => {
    const embed = buildDiscordToolApprovalEmbed({
      id: "approval-1",
      type: "tool.approval.requested",
      timestamp: Date.now(),
      sessionId: "session-1",
      payload: {
        toolCallId: "call-1",
        toolName: "shell_exec",
        arguments: {},
        riskLevel: "high",
        description: "Run a shell command",
      },
    } satisfies ToolApprovalRequestedMessage).toJSON();
    const adapterSource = readFileSync(
      join(ROOT, "channels/discord/src/adapter.ts"),
      "utf-8",
    );
    const commandsSource = readFileSync(
      join(ROOT, "channels/discord/src/slash-commands.ts"),
      "utf-8",
    );

    expect(embed.title).toBe("Tool Approval Required");
    expect(adapterSource).toContain("ButtonBuilder");
    expect(adapterSource).toContain("tool.approval.response");
    expect(commandsSource).toContain("StringSelectMenuBuilder");
    expect(commandsSource).toContain("karna:skill-select");
  });
});

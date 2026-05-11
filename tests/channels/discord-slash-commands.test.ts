import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDiscordSlashCommandNames } from "../../channels/discord/src/slash-commands.js";

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
});

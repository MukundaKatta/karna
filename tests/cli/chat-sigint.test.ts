import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const CHAT_COMMAND = join(process.cwd(), "apps/cli/src/commands/chat.ts");

describe("CLI chat SIGINT handling", () => {
  it("cancels active responses without closing the session", () => {
    const source = readFileSync(CHAT_COMMAND, "utf-8");

    expect(source).toContain('rl.on("SIGINT"');
    expect(source).toContain('type: "chat.cancel"');
    expect(source).toContain('reason: "Cancelled from CLI with Ctrl+C"');
    expect(source).toContain("Conversation history preserved");
    expect(source).toContain("rl.prompt()");
  });

  it("does not use a process-wide SIGINT handler for chat cancellation", () => {
    const source = readFileSync(CHAT_COMMAND, "utf-8");

    expect(source).not.toContain('process.on("SIGINT"');
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendToTranscript,
  cleanupExpiredTranscripts,
  deleteTranscript,
  getTranscriptLength,
  readTranscript,
} from "../../gateway/src/session/store.js";

describe("session transcript store", () => {
  const originalDir = process.env["KARNA_TRANSCRIPT_DIR"];
  const originalMaxBytes = process.env["KARNA_TRANSCRIPT_MAX_BYTES"];
  const originalRetention = process.env["KARNA_TRANSCRIPT_RETENTION_DAYS"];
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "karna-transcripts-"));
    process.env["KARNA_TRANSCRIPT_DIR"] = dir;
    process.env["KARNA_TRANSCRIPT_MAX_BYTES"] = "180";
    process.env["KARNA_TRANSCRIPT_RETENTION_DAYS"] = "30";
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    restoreEnv("KARNA_TRANSCRIPT_DIR", originalDir);
    restoreEnv("KARNA_TRANSCRIPT_MAX_BYTES", originalMaxBytes);
    restoreEnv("KARNA_TRANSCRIPT_RETENTION_DAYS", originalRetention);
  });

  it("rotates transcript files and reads all segments chronologically", async () => {
    await appendToTranscript("session/one", {
      id: "m1",
      sessionId: "session/one",
      role: "user",
      content: "first message with enough content to make rotation likely",
      timestamp: Date.now(),
    });
    await appendToTranscript("session/one", {
      id: "m2",
      sessionId: "session/one",
      role: "assistant",
      content: "second message with enough content to rotate the active segment",
      timestamp: Date.now(),
    });

    const files = await readdir(dir);
    expect(files.filter((file) => file.startsWith("session_one")).length).toBeGreaterThanOrEqual(2);
    expect(await getTranscriptLength("session/one")).toBe(2);
    expect((await readTranscript("session/one")).map((message) => message.id)).toEqual(["m1", "m2"]);
  });

  it("persists one JSON object per line with tool metadata", async () => {
    await appendToTranscript("tool-session", {
      id: "tool-1",
      sessionId: "tool-session",
      role: "tool",
      content: "{\"result\":\"ok\"}",
      timestamp: Date.now(),
      metadata: {
        toolCallId: "call_123",
        toolName: "search",
        finishReason: "tool-result",
      },
    });

    const files = await readdir(dir);
    expect(files).toContain("tool-session.jsonl");

    const messages = await readTranscript("tool-session");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.metadata).toMatchObject({
      toolCallId: "call_123",
      toolName: "search",
    });
  });

  it("deletes expired transcript segments during cleanup", async () => {
    await appendToTranscript("old-session", {
      id: "m1",
      sessionId: "old-session",
      role: "user",
      content: "old",
      timestamp: Date.now(),
    });

    const files = await readdir(dir);
    const transcriptPath = join(dir, files[0]!);
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await utimes(transcriptPath, oldDate, oldDate);

    expect((await stat(transcriptPath)).mtimeMs).toBeLessThan(Date.now());
    expect(await cleanupExpiredTranscripts()).toBe(1);
    expect(await deleteTranscript("old-session")).toBe(false);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

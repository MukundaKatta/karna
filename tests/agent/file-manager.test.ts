import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearFileAuditLog,
  fileDeleteTool,
  fileInfoTool,
  fileListTool,
  fileMoveTool,
  fileReadTool,
  fileSearchTool,
  fileWriteTool,
  getFileAuditLog,
} from "../../agent/src/tools/builtin/files.js";
import type { ToolExecutionContext } from "../../agent/src/tools/registry.js";

describe("file manager tools", () => {
  let dir: string;
  let context: ToolExecutionContext;
  const originalAllowedDirs = process.env.KARNA_FILE_ALLOWED_DIRS;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "karna-files-"));
    context = {
      agentId: "agent-files",
      sessionId: "session-files",
      workingDirectory: dir,
    };
    delete process.env.KARNA_FILE_ALLOWED_DIRS;
    clearFileAuditLog();
  });

  afterEach(async () => {
    process.env.KARNA_FILE_ALLOWED_DIRS = originalAllowedDirs;
    await rm(dir, { recursive: true, force: true });
  });

  it("reads, writes, lists, searches, moves, inspects, and deletes files", async () => {
    await fileWriteTool.execute(
      {
        path: "notes/today.txt",
        content: "alpha\nbeta\nneedle",
        createDirectories: true,
      },
      context,
    );

    const read = await fileReadTool.execute(
      { path: "notes/today.txt", offset: 1, limit: 2 },
      context,
    );
    expect(read).toMatchObject({
      content: "beta\nneedle",
      totalLines: 3,
      startLine: 1,
      endLine: 3,
    });

    const list = await fileListTool.execute(
      { path: ".", recursive: true },
      context,
    );
    expect(JSON.stringify(list)).toContain("today.txt");

    const search = await fileSearchTool.execute(
      { path: ".", pattern: "needle", glob: "*.txt" },
      context,
    );
    expect(search).toMatchObject({ totalMatches: 1 });

    await fileMoveTool.execute(
      { sourcePath: "notes/today.txt", targetPath: "archive/today.txt" },
      context,
    );
    const info = await fileInfoTool.execute({ path: "archive/today.txt" }, context);
    expect(info).toMatchObject({
      name: "today.txt",
      extension: ".txt",
      type: "file",
    });

    await fileDeleteTool.execute({ path: "archive/today.txt" }, context);
    await expect(stat(join(dir, "archive/today.txt"))).rejects.toThrow();

    const operations = getFileAuditLog().map((entry) => entry.operation);
    expect(operations).toEqual([
      "file_write",
      "file_read",
      "file_list",
      "file_search",
      "file_move",
      "file_info",
      "file_delete",
    ]);

    const auditFile = await readFile(
      join(dir, ".karna", "file-operations.audit.jsonl"),
      "utf-8",
    );
    expect(auditFile).toContain("\"operation\":\"file_delete\"");
  });

  it("blocks files outside the sandbox and sensitive paths", async () => {
    const outside = join(tmpdir(), "karna-outside.txt");
    await writeFile(outside, "secret", "utf-8");

    await expect(fileReadTool.execute({ path: outside }, context)).rejects.toThrow(
      "outside allowed directories",
    );
    await expect(
      fileWriteTool.execute(
        { path: ".env", content: "TOKEN=secret" },
        context,
      ),
    ).rejects.toThrow("sensitive file deny list");
    await rm(outside, { force: true });
  });

  it("allows additional directories configured by environment", async () => {
    const sharedDir = await mkdtemp(join(tmpdir(), "karna-shared-"));
    process.env.KARNA_FILE_ALLOWED_DIRS = sharedDir;
    await writeFile(join(sharedDir, "shared.txt"), "allowed", "utf-8");

    const read = await fileReadTool.execute(
      { path: join(sharedDir, "shared.txt") },
      context,
    );

    expect(read).toMatchObject({ content: "allowed" });
    await rm(sharedDir, { recursive: true, force: true });
  });

  it("enforces the 10MB read limit", async () => {
    await writeFile(join(dir, "large.txt"), "x".repeat(10 * 1024 * 1024 + 1));

    await expect(
      fileReadTool.execute({ path: "large.txt" }, context),
    ).rejects.toThrow("File too large");
  });
});

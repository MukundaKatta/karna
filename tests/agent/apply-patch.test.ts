import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { applyPatchTool } from "../../agent/src/tools/builtin/apply-patch.js";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Apply Patch Tool", () => {
  let tempDir: string;
  let testFile: string;
  const ctx = { sessionId: "s1", agentId: "a1" };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "karna-patch-test-"));
    testFile = join(tempDir, "test.txt");
    writeFileSync(testFile, "line 1\nline 2\nline 3\nline 4\nline 5\n");
  });

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true }); } catch {}
  });

  it("applies a simple single-hunk patch", async () => {
    const patch = `--- a/test.txt
+++ b/test.txt
@@ -2,3 +2,3 @@
 line 2
-line 3
+line 3 modified
 line 4`;

    const result = await applyPatchTool.execute({ filePath: testFile, patch }, ctx) as Record<string, unknown>;
    expect(result["success"]).toBe(true);
    expect(result["hunksApplied"]).toBe(1);

    const content = readFileSync(testFile, "utf-8");
    expect(content).toContain("line 3 modified");
    expect(content).not.toContain("\nline 3\n");
  });

  it("supports dry run mode", async () => {
    const patch = `@@ -2,2 +2,2 @@
 line 2
-line 3
+line 3 changed`;

    const result = await applyPatchTool.execute({ filePath: testFile, patch, dryRun: true }, ctx) as Record<string, unknown>;
    expect(result["success"]).toBe(true);
    expect(result["dryRun"]).toBe(true);

    // File should be unchanged
    const content = readFileSync(testFile, "utf-8");
    expect(content).toContain("line 3\n");
  });

  it("rejects patch with context mismatch", async () => {
    const patch = `@@ -2,2 +2,2 @@
 wrong context
-line 3
+line 3 changed`;

    const result = await applyPatchTool.execute({ filePath: testFile, patch }, ctx) as Record<string, unknown>;
    expect(result["success"]).toBe(false);
    expect(String(result["error"])).toContain("Context mismatch");
  });

  it("returns error for nonexistent file", async () => {
    const result = await applyPatchTool.execute(
      { filePath: join(tempDir, "nonexistent.txt"), patch: "@@ -1,1 +1,1 @@\n-x\n+y" },
      ctx,
    ) as Record<string, unknown>;
    expect(result["success"]).toBe(false);
    expect(String(result["error"])).toContain("not found");
  });

  it("rejects empty patch via validation", async () => {
    await expect(
      applyPatchTool.execute({ filePath: testFile, patch: "" }, ctx),
    ).rejects.toThrow();
  });

  it("applies addition-only patch", async () => {
    const patch = `@@ -2,2 +2,3 @@
 line 2
+new line inserted
 line 3`;

    const result = await applyPatchTool.execute({ filePath: testFile, patch }, ctx) as Record<string, unknown>;
    expect(result["success"]).toBe(true);

    const content = readFileSync(testFile, "utf-8");
    expect(content).toContain("new line inserted");
  });

  it("applies deletion-only patch", async () => {
    const patch = `@@ -2,3 +2,2 @@
 line 2
-line 3
 line 4`;

    const result = await applyPatchTool.execute({ filePath: testFile, patch }, ctx) as Record<string, unknown>;
    expect(result["success"]).toBe(true);

    const content = readFileSync(testFile, "utf-8");
    expect(content).not.toContain("line 3");
    expect((result["newLineCount"] as number)).toBeLessThan(result["originalLineCount"] as number);
  });
});

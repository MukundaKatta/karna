// ─── Apply Patch Tool ────────────────────────────────────────────────────────
// Apply multi-hunk unified diff patches to files.
// Similar to `patch` command but safer — validates before applying.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { z } from "zod";
import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../registry.js";

const logger = pino({ name: "tool-apply-patch" });

const ApplyPatchInputSchema = z.object({
  filePath: z.string().min(1).describe("Absolute path to the file to patch"),
  patch: z.string().min(1).describe("Unified diff patch content"),
  dryRun: z.boolean().optional().describe("If true, validate without applying. Default: false"),
});

interface PatchHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

export const applyPatchTool: ToolDefinitionRuntime = {
  name: "apply_patch",
  description:
    "Apply a unified diff patch to a file. Supports multi-hunk patches. " +
    "Use dryRun=true to validate the patch without applying it. " +
    "The patch format should be standard unified diff (like git diff output).",
  parameters: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "Absolute path to the file to patch" },
      patch: { type: "string", description: "Unified diff patch content" },
      dryRun: { type: "boolean", description: "Validate without applying" },
    },
    required: ["filePath", "patch"],
  },
  inputSchema: ApplyPatchInputSchema,
  riskLevel: "medium",
  requiresApproval: false,
  timeout: 10_000,
  tags: ["files", "patch", "diff"],

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
    const params = ApplyPatchInputSchema.parse(input);
    const { filePath, patch, dryRun } = params;

    logger.info({ filePath, dryRun, patchLength: patch.length }, "Applying patch");

    if (!existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    try {
      const originalContent = readFileSync(filePath, "utf-8");
      const originalLines = originalContent.split("\n");
      const hunks = parseHunks(patch);

      if (hunks.length === 0) {
        return { success: false, error: "No valid hunks found in patch" };
      }

      // Apply hunks in reverse order (bottom to top) to preserve line numbers
      const resultLines = [...originalLines];
      const sortedHunks = [...hunks].sort((a, b) => b.oldStart - a.oldStart);

      for (const hunk of sortedHunks) {
        const startIdx = hunk.oldStart - 1; // Convert to 0-indexed

        // Validate context lines match
        let offset = 0;
        for (const line of hunk.lines) {
          if (line.startsWith(" ")) {
            const expected = line.slice(1);
            const actual = resultLines[startIdx + offset];
            if (actual !== expected) {
              return {
                success: false,
                error: `Context mismatch at line ${startIdx + offset + 1}: expected "${expected}", got "${actual}"`,
              };
            }
            offset++;
          } else if (line.startsWith("-")) {
            offset++;
          }
          // "+" lines don't consume original lines
        }

        // Apply the hunk
        const newLines: string[] = [];
        for (const line of hunk.lines) {
          if (line.startsWith("+")) {
            newLines.push(line.slice(1));
          } else if (line.startsWith(" ")) {
            newLines.push(line.slice(1));
          }
          // "-" lines are removed (not added to newLines)
        }

        resultLines.splice(startIdx, hunk.oldCount, ...newLines);
      }

      if (dryRun) {
        return {
          success: true,
          dryRun: true,
          hunksApplied: hunks.length,
          linesChanged: originalLines.length !== resultLines.length
            ? Math.abs(originalLines.length - resultLines.length)
            : hunks.reduce((sum, h) => sum + h.lines.length, 0),
        };
      }

      writeFileSync(filePath, resultLines.join("\n"), "utf-8");

      logger.info({ filePath, hunksApplied: hunks.length }, "Patch applied successfully");

      return {
        success: true,
        hunksApplied: hunks.length,
        originalLineCount: originalLines.length,
        newLineCount: resultLines.length,
      };
    } catch (error) {
      logger.error({ error: String(error), filePath }, "Failed to apply patch");
      return { success: false, error: String(error) };
    }
  },
};

// ─── Patch Parsing ──────────────────────────────────────────────────────────

function parseHunks(patch: string): PatchHunk[] {
  const hunks: PatchHunk[] = [];
  const lines = patch.split("\n");

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // Look for hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (hunkMatch) {
      const hunk: PatchHunk = {
        oldStart: parseInt(hunkMatch[1]!, 10),
        oldCount: parseInt(hunkMatch[2] ?? "1", 10),
        newStart: parseInt(hunkMatch[3]!, 10),
        newCount: parseInt(hunkMatch[4] ?? "1", 10),
        lines: [],
      };

      i++;
      // Collect hunk lines
      while (i < lines.length) {
        const hunkLine = lines[i]!;
        if (hunkLine.startsWith("@@") || hunkLine.startsWith("diff ") || hunkLine.startsWith("---") || hunkLine.startsWith("+++")) {
          break;
        }
        if (hunkLine.startsWith("+") || hunkLine.startsWith("-") || hunkLine.startsWith(" ")) {
          hunk.lines.push(hunkLine);
        }
        i++;
      }

      if (hunk.lines.length > 0) {
        hunks.push(hunk);
      }
    } else {
      i++;
    }
  }

  return hunks;
}

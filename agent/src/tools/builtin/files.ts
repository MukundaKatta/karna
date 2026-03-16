// ─── File Operations Tool ──────────────────────────────────────────────────

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../registry.js";

const MAX_FILE_SIZE = 1_000_000; // 1MB
const MAX_SEARCH_RESULTS = 50;
const MAX_READ_LINES = 5000;

// ─── File Read Tool ─────────────────────────────────────────────────────────

const FileReadInputSchema = z.object({
  path: z.string().min(1).describe("File path to read (relative or absolute)"),
  offset: z.number().int().nonnegative().optional().describe("Starting line number (0-based)"),
  limit: z.number().int().positive().max(MAX_READ_LINES).optional().describe("Number of lines to read"),
});

export const fileReadTool: ToolDefinitionRuntime = {
  name: "file_read",
  description:
    "Read the contents of a file. Supports reading specific line ranges with offset and limit.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to read" },
      offset: {
        type: "integer",
        description: "Starting line number (0-based)",
        minimum: 0,
      },
      limit: {
        type: "integer",
        description: "Number of lines to read",
        minimum: 1,
        maximum: MAX_READ_LINES,
      },
    },
    required: ["path"],
  },
  inputSchema: FileReadInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 10_000,
  tags: ["file", "read"],

  async execute(
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = FileReadInputSchema.parse(input);
    const filePath = resolvePath(parsed.path, context.workingDirectory);

    const fileStat = await stat(filePath);
    if (fileStat.size > MAX_FILE_SIZE) {
      throw new Error(
        `File too large (${fileStat.size} bytes). Maximum: ${MAX_FILE_SIZE} bytes.`
      );
    }

    const content = await readFile(filePath, "utf-8");

    if (parsed.offset !== undefined || parsed.limit !== undefined) {
      const lines = content.split("\n");
      const start = parsed.offset ?? 0;
      const end = parsed.limit ? start + parsed.limit : lines.length;
      const slice = lines.slice(start, end);
      return {
        path: filePath,
        content: slice.join("\n"),
        totalLines: lines.length,
        startLine: start,
        endLine: Math.min(end, lines.length),
      };
    }

    return { path: filePath, content, totalLines: content.split("\n").length };
  },
};

// ─── File Write Tool ────────────────────────────────────────────────────────

const FileWriteInputSchema = z.object({
  path: z.string().min(1).describe("File path to write to"),
  content: z.string().describe("Content to write"),
  createDirectories: z
    .boolean()
    .optional()
    .default(false)
    .describe("Create parent directories if they don't exist"),
});

export const fileWriteTool: ToolDefinitionRuntime = {
  name: "file_write",
  description:
    "Write content to a file, creating or overwriting it. " +
    "Use createDirectories to create parent directories automatically.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to write to" },
      content: { type: "string", description: "Content to write" },
      createDirectories: {
        type: "boolean",
        description: "Create parent directories if they don't exist",
      },
    },
    required: ["path", "content"],
  },
  inputSchema: FileWriteInputSchema,
  riskLevel: "high",
  requiresApproval: true,
  timeout: 10_000,
  tags: ["file", "write"],

  async execute(
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = FileWriteInputSchema.parse(input);
    const filePath = resolvePath(parsed.path, context.workingDirectory);

    if (parsed.createDirectories) {
      const { mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(filePath), { recursive: true });
    }

    await writeFile(filePath, parsed.content, "utf-8");

    return {
      path: filePath,
      bytesWritten: Buffer.byteLength(parsed.content, "utf-8"),
    };
  },
};

// ─── File List Tool ─────────────────────────────────────────────────────────

const FileListInputSchema = z.object({
  path: z.string().min(1).describe("Directory path to list"),
  recursive: z.boolean().optional().default(false).describe("List recursively"),
  maxDepth: z.number().int().positive().max(10).optional().default(3).describe("Max recursion depth"),
});

export const fileListTool: ToolDefinitionRuntime = {
  name: "file_list",
  description:
    "List files and directories in a given path. Supports recursive listing.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path to list" },
      recursive: { type: "boolean", description: "List recursively" },
      maxDepth: {
        type: "integer",
        description: "Max recursion depth",
        minimum: 1,
        maximum: 10,
      },
    },
    required: ["path"],
  },
  inputSchema: FileListInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 10_000,
  tags: ["file", "list"],

  async execute(
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = FileListInputSchema.parse(input);
    const dirPath = resolvePath(parsed.path, context.workingDirectory);

    const entries = await listDirectory(dirPath, parsed.recursive, parsed.maxDepth, 0);

    return {
      path: dirPath,
      entries,
      totalEntries: entries.length,
    };
  },
};

// ─── File Search Tool ───────────────────────────────────────────────────────

const FileSearchInputSchema = z.object({
  path: z.string().min(1).describe("Directory to search in"),
  pattern: z.string().min(1).describe("Search pattern (substring match in file content)"),
  glob: z.string().optional().describe("File name glob pattern (e.g. '*.ts')"),
  maxResults: z
    .number()
    .int()
    .positive()
    .max(MAX_SEARCH_RESULTS)
    .optional()
    .default(20)
    .describe("Maximum number of results"),
});

export const fileSearchTool: ToolDefinitionRuntime = {
  name: "file_search",
  description:
    "Search for a text pattern in files within a directory. " +
    "Returns matching file paths and line numbers.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory to search in" },
      pattern: { type: "string", description: "Search pattern (substring match)" },
      glob: { type: "string", description: "File name glob pattern (e.g. '*.ts')" },
      maxResults: {
        type: "integer",
        description: "Maximum number of results",
        minimum: 1,
        maximum: MAX_SEARCH_RESULTS,
      },
    },
    required: ["path", "pattern"],
  },
  inputSchema: FileSearchInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 30_000,
  tags: ["file", "search"],

  async execute(
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = FileSearchInputSchema.parse(input);
    const dirPath = resolvePath(parsed.path, context.workingDirectory);

    const files = await listDirectory(dirPath, true, 5, 0);
    const fileEntries = files.filter((e) => e.type === "file");

    // Apply glob filter
    const filteredFiles = parsed.glob
      ? fileEntries.filter((f) => matchGlob(f.name, parsed.glob!))
      : fileEntries;

    const matches: Array<{
      file: string;
      line: number;
      content: string;
    }> = [];

    for (const file of filteredFiles) {
      if (matches.length >= parsed.maxResults) break;

      try {
        const fileStat = await stat(file.path);
        if (fileStat.size > MAX_FILE_SIZE) continue;

        const content = await readFile(file.path, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(parsed.pattern)) {
            matches.push({
              file: file.path,
              line: i + 1,
              content: lines[i].trim(),
            });
            if (matches.length >= parsed.maxResults) break;
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return {
      pattern: parsed.pattern,
      directory: dirPath,
      matches,
      totalMatches: matches.length,
    };
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolvePath(path: string, workingDirectory?: string): string {
  if (path.startsWith("/")) return resolve(path);
  return resolve(workingDirectory ?? process.cwd(), path);
}

interface DirectoryEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
}

async function listDirectory(
  dirPath: string,
  recursive: boolean,
  maxDepth: number,
  currentDepth: number
): Promise<DirectoryEntry[]> {
  const entries: DirectoryEntry[] = [];
  const dirEntries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of dirEntries) {
    // Skip hidden files and common noise directories
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    const entryPath = join(dirPath, entry.name);

    if (entry.isFile()) {
      const fileStat = await stat(entryPath).catch(() => null);
      entries.push({
        name: entry.name,
        path: entryPath,
        type: "file",
        size: fileStat?.size,
      });
    } else if (entry.isDirectory()) {
      entries.push({
        name: entry.name,
        path: entryPath,
        type: "directory",
      });

      if (recursive && currentDepth < maxDepth) {
        const subEntries = await listDirectory(
          entryPath,
          recursive,
          maxDepth,
          currentDepth + 1
        );
        entries.push(...subEntries);
      }
    }
  }

  return entries;
}

/**
 * Simple glob matching supporting * and ? wildcards.
 */
function matchGlob(fileName: string, pattern: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regex}$`).test(fileName);
}

// ─── File Operations Tools ─────────────────────────────────────────────────

import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../registry.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_SEARCH_RESULTS = 50;
const MAX_READ_LINES = 5000;
const AUDIT_LOG_LIMIT = 200;
const auditLog: FileAuditEntry[] = [];

export interface FileAuditEntry {
  operation: string;
  path: string;
  targetPath?: string;
  agentId: string;
  sessionId: string;
  timestamp: string;
  success: boolean;
  error?: string;
}

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
    return auditFileOperation("file_read", parsed.path, context, async () => {
      const filePath = resolvePath(parsed.path, context);

      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        throw new Error(`Path is not a file: ${filePath}`);
      }
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
    });
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
    return auditFileOperation("file_write", parsed.path, context, async () => {
      const filePath = resolvePath(parsed.path, context);

      if (parsed.createDirectories) {
        await mkdir(dirname(filePath), { recursive: true });
      }

      await writeFile(filePath, parsed.content, "utf-8");

      return {
        path: filePath,
        bytesWritten: Buffer.byteLength(parsed.content, "utf-8"),
      };
    });
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
    return auditFileOperation("file_list", parsed.path, context, async () => {
      const dirPath = resolvePath(parsed.path, context);

      const entries = await listDirectory(dirPath, parsed.recursive, parsed.maxDepth, 0);

      return {
        path: dirPath,
        entries,
        totalEntries: entries.length,
      };
    });
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
    return auditFileOperation("file_search", parsed.path, context, async () => {
      const dirPath = resolvePath(parsed.path, context);

      const files = await listDirectory(dirPath, true, 5, 0);
      const fileEntries = files.filter((e) => e.type === "file");

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
    });
  },
};

// ─── File Move Tool ────────────────────────────────────────────────────────

const FileMoveInputSchema = z.object({
  sourcePath: z.string().min(1).describe("Existing file or directory path"),
  targetPath: z.string().min(1).describe("Destination file or directory path"),
});

export const fileMoveTool: ToolDefinitionRuntime = {
  name: "file_move",
  description: "Move or rename a file or directory inside the allowed file sandbox.",
  parameters: {
    type: "object",
    properties: {
      sourcePath: { type: "string", description: "Existing file or directory path" },
      targetPath: { type: "string", description: "Destination file or directory path" },
    },
    required: ["sourcePath", "targetPath"],
  },
  inputSchema: FileMoveInputSchema,
  riskLevel: "high",
  requiresApproval: true,
  timeout: 10_000,
  tags: ["file", "move"],

  async execute(
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = FileMoveInputSchema.parse(input);
    return auditFileOperation(
      "file_move",
      parsed.sourcePath,
      context,
      async () => {
        const sourcePath = resolvePath(parsed.sourcePath, context);
        const targetPath = resolvePath(parsed.targetPath, context);
        await mkdir(dirname(targetPath), { recursive: true });
        await rename(sourcePath, targetPath);
        return { sourcePath, targetPath };
      },
      parsed.targetPath
    );
  },
};

// ─── File Delete Tool ──────────────────────────────────────────────────────

const FileDeleteInputSchema = z.object({
  path: z.string().min(1).describe("File or directory path to delete"),
  recursive: z
    .boolean()
    .optional()
    .default(false)
    .describe("Allow recursive directory deletion"),
});

export const fileDeleteTool: ToolDefinitionRuntime = {
  name: "file_delete",
  description:
    "Delete a file or directory inside the allowed file sandbox. Directories require recursive=true.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File or directory path to delete" },
      recursive: { type: "boolean", description: "Allow recursive directory deletion" },
    },
    required: ["path"],
  },
  inputSchema: FileDeleteInputSchema,
  riskLevel: "critical",
  requiresApproval: true,
  timeout: 10_000,
  tags: ["file", "delete"],

  async execute(
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = FileDeleteInputSchema.parse(input);
    return auditFileOperation("file_delete", parsed.path, context, async () => {
      const filePath = resolvePath(parsed.path, context);
      await rm(filePath, { recursive: parsed.recursive, force: false });
      return { path: filePath, deleted: true };
    });
  },
};

// ─── File Info Tool ────────────────────────────────────────────────────────

const FileInfoInputSchema = z.object({
  path: z.string().min(1).describe("File or directory path to inspect"),
});

export const fileInfoTool: ToolDefinitionRuntime = {
  name: "file_info",
  description:
    "Return metadata for a file or directory, including size, type, modified date, and extension.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File or directory path to inspect" },
    },
    required: ["path"],
  },
  inputSchema: FileInfoInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 10_000,
  tags: ["file", "info"],

  async execute(
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = FileInfoInputSchema.parse(input);
    return auditFileOperation("file_info", parsed.path, context, async () => {
      const filePath = resolvePath(parsed.path, context);
      const fileStat = await stat(filePath);
      return {
        path: filePath,
        name: basename(filePath),
        extension: extname(filePath),
        type: fileStat.isFile()
          ? "file"
          : fileStat.isDirectory()
            ? "directory"
            : "other",
        size: fileStat.size,
        createdAt: fileStat.birthtime.toISOString(),
        modifiedAt: fileStat.mtime.toISOString(),
      };
    });
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getFileAuditLog(): FileAuditEntry[] {
  return [...auditLog];
}

export function clearFileAuditLog(): void {
  auditLog.length = 0;
}

function resolvePath(path: string, context: ToolExecutionContext): string {
  const workingDirectory = resolve(context.workingDirectory ?? process.cwd());
  const filePath = isAbsolute(path) ? resolve(path) : resolve(workingDirectory, path);
  assertAllowedPath(filePath, context);
  assertNotSensitivePath(filePath);
  return filePath;
}

function assertAllowedPath(path: string, context: ToolExecutionContext): void {
  const allowedDirs = getAllowedDirectories(context);
  if (allowedDirs.some((dir) => isPathInside(path, dir))) {
    return;
  }

  throw new Error(
    `Path is outside allowed directories. Configure KARNA_FILE_ALLOWED_DIRS or use the session working directory.`
  );
}

function assertNotSensitivePath(path: string): void {
  const normalized = path.split(sep).join("/");
  const home = homedir();
  const sensitiveDirs = [
    ".ssh",
    ".aws",
    ".gnupg",
    ".kube",
    ".docker",
    ".config/gh",
    ".config/gcloud",
  ];

  if (basename(path) === ".env" || basename(path).startsWith(".env.")) {
    throw new Error(`Path is blocked by sensitive file deny list: ${path}`);
  }

  for (const entry of sensitiveDirs) {
    const absolute = resolve(home, entry).split(sep).join("/");
    if (normalized === absolute || normalized.startsWith(`${absolute}/`)) {
      throw new Error(`Path is blocked by sensitive directory deny list: ${path}`);
    }
  }
}

function getAllowedDirectories(context: ToolExecutionContext): string[] {
  const configured = (process.env.KARNA_FILE_ALLOWED_DIRS ?? "")
    .split(/[,:]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(expandHome(entry)));

  return [
    resolve(context.workingDirectory ?? process.cwd()),
    ...configured,
  ].filter((entry, index, dirs) => dirs.indexOf(entry) === index);
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith(`~${sep}`) || path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }
  return path;
}

function isPathInside(path: string, directory: string): boolean {
  const diff = relative(directory, path);
  return diff === "" || (!diff.startsWith("..") && !isAbsolute(diff));
}

async function auditFileOperation<T>(
  operation: string,
  path: string,
  context: ToolExecutionContext,
  callback: () => Promise<T>,
  targetPath?: string
): Promise<T> {
  try {
    const result = await callback();
    await recordAudit({
      operation,
      path,
      targetPath,
      agentId: context.agentId,
      sessionId: context.sessionId,
      timestamp: new Date().toISOString(),
      success: true,
    }, context);
    return result;
  } catch (error) {
    await recordAudit({
      operation,
      path,
      targetPath,
      agentId: context.agentId,
      sessionId: context.sessionId,
      timestamp: new Date().toISOString(),
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, context);
    throw error;
  }
}

async function recordAudit(
  entry: FileAuditEntry,
  context: ToolExecutionContext
): Promise<void> {
  auditLog.push(entry);
  if (auditLog.length > AUDIT_LOG_LIMIT) {
    auditLog.shift();
  }

  const dir = resolve(context.workingDirectory ?? process.cwd(), ".karna");
  const auditPath = join(dir, "file-operations.audit.jsonl");
  try {
    await mkdir(dir, { recursive: true });
    await appendFile(auditPath, `${JSON.stringify(entry)}\n`, "utf-8");
  } catch {
    // In-memory audit still records the operation if the filesystem log fails.
  }
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

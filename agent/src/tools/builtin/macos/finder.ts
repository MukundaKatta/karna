// ─── macOS Finder / File Operations Tools ──────────────────────────────────

import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../../registry.js";

const DEFAULT_TIMEOUT_MS = 10_000;

// ─── Helpers ───────────────────────────────────────────────────────────────

function assertMacOS(): void {
  if (process.platform !== "darwin") {
    throw new Error("This tool is only available on macOS");
  }
}

function runExecFile(
  cmd: string,
  args: string[],
  timeout = DEFAULT_TIMEOUT_MS
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 2_000_000 }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException & { killed?: boolean }).killed) {
        reject(new Error(`Command timed out after ${timeout}ms`));
        return;
      }
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function runOsascript(script: string, timeout = DEFAULT_TIMEOUT_MS): Promise<string> {
  return runExecFile("osascript", ["-e", script], timeout).then((r) => r.stdout.trim());
}

// ─── mac_open_file ─────────────────────────────────────────────────────────

const OpenFileInputSchema = z.object({
  path: z.string().min(1).describe("File path to open with its default application"),
  app: z.string().optional().describe("Specific application to open the file with"),
});

export const macOpenFileTool: ToolDefinitionRuntime = {
  name: "mac_open_file",
  description:
    "Open a file with its default macOS application, or with a specified application. " +
    "Works with any file type that has a registered handler.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to open" },
      app: { type: "string", description: "Specific application to open the file with" },
    },
    required: ["path"],
  },
  inputSchema: OpenFileInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: DEFAULT_TIMEOUT_MS,
  tags: ["macos", "finder", "files"],

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
    assertMacOS();
    const parsed = OpenFileInputSchema.parse(input);

    const filePath = parsed.path.startsWith("/")
      ? parsed.path
      : resolve(context.workingDirectory ?? process.cwd(), parsed.path);

    const args: string[] = [];
    if (parsed.app) {
      args.push("-a", parsed.app);
    }
    args.push(filePath);

    await runExecFile("open", args);
    return {
      output: `Opened ${filePath}${parsed.app ? ` with ${parsed.app}` : ""}`,
      isError: false,
    };
  },
};

// ─── mac_reveal_in_finder ──────────────────────────────────────────────────

const RevealInFinderInputSchema = z.object({
  path: z.string().min(1).describe("File or folder path to reveal in Finder"),
});

export const macRevealInFinderTool: ToolDefinitionRuntime = {
  name: "mac_reveal_in_finder",
  description:
    "Reveal a file or folder in Finder, highlighting it in its parent directory.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File or folder path to reveal" },
    },
    required: ["path"],
  },
  inputSchema: RevealInFinderInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: DEFAULT_TIMEOUT_MS,
  tags: ["macos", "finder"],

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
    assertMacOS();
    const parsed = RevealInFinderInputSchema.parse(input);

    const filePath = parsed.path.startsWith("/")
      ? parsed.path
      : resolve(context.workingDirectory ?? process.cwd(), parsed.path);

    await runExecFile("open", ["-R", filePath]);
    return { output: `Revealed in Finder: ${filePath}`, isError: false, durationMs: 0 };
  },
};

// ─── mac_get_downloads ─────────────────────────────────────────────────────

const GetDownloadsInputSchema = z.object({
  limit: z.number().int().positive().max(100).optional().default(20).describe("Max files to list (default 20)"),
  sortBy: z
    .enum(["date", "name", "size"])
    .optional()
    .default("date")
    .describe("Sort order: date (newest first), name, or size (largest first)"),
});

export const macGetDownloadsTool: ToolDefinitionRuntime = {
  name: "mac_get_downloads",
  description:
    "List recent files in the macOS Downloads folder, sorted by date (newest first), name, or size.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "integer", description: "Max files to list (default 20)", minimum: 1, maximum: 100 },
      sortBy: {
        type: "string",
        description: "Sort order: date, name, or size",
        enum: ["date", "name", "size"],
      },
    },
    required: [],
  },
  inputSchema: GetDownloadsInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: DEFAULT_TIMEOUT_MS,
  tags: ["macos", "finder", "files"],

  async execute(input: Record<string, unknown>): Promise<unknown> {
    assertMacOS();
    const parsed = GetDownloadsInputSchema.parse(input);

    const downloadsDir = join(homedir(), "Downloads");

    const dirEntries = await readdir(downloadsDir, { withFileTypes: true });
    const files: Array<{ name: string; path: string; size: number; modified: Date }> = [];

    for (const entry of dirEntries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = join(downloadsDir, entry.name);
      try {
        const s = await stat(fullPath);
        files.push({
          name: entry.name,
          path: fullPath,
          size: s.size,
          modified: s.mtime,
        });
      } catch {
        // skip inaccessible files
      }
    }

    // Sort
    switch (parsed.sortBy) {
      case "name":
        files.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "size":
        files.sort((a, b) => b.size - a.size);
        break;
      case "date":
      default:
        files.sort((a, b) => b.modified.getTime() - a.modified.getTime());
        break;
    }

    const limited = files.slice(0, parsed.limit);
    const output = limited
      .map(
        (f) =>
          `${f.name}  (${formatBytes(f.size)}, ${f.modified.toISOString().slice(0, 10)})`
      )
      .join("\n");

    return {
      output: output || "No files found in Downloads",
      isError: false,
      files: limited.map((f) => ({
        name: f.name,
        path: f.path,
        size: f.size,
        modified: f.modified.toISOString(),
      })),
      count: limited.length,
    };
  },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ─── mac_trash ─────────────────────────────────────────────────────────────

const TrashInputSchema = z.object({
  path: z.string().min(1).describe("File or folder path to move to Trash"),
});

export const macTrashTool: ToolDefinitionRuntime = {
  name: "mac_trash",
  description:
    "Move a file or folder to the macOS Trash. This is a safe delete that can be undone from Trash.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File or folder path to move to Trash" },
    },
    required: ["path"],
  },
  inputSchema: TrashInputSchema,
  riskLevel: "medium",
  requiresApproval: true,
  timeout: DEFAULT_TIMEOUT_MS,
  tags: ["macos", "finder", "files"],

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
    assertMacOS();
    const parsed = TrashInputSchema.parse(input);

    const filePath = parsed.path.startsWith("/")
      ? parsed.path
      : resolve(context.workingDirectory ?? process.cwd(), parsed.path);

    // Use Finder AppleScript to move to Trash (respects Trash behavior)
    const escapedPath = filePath.replace(/"/g, '\\"');
    const script = `
      tell application "Finder"
        delete POSIX file "${escapedPath}"
      end tell
    `;

    try {
      await runOsascript(script);
      return { output: `Moved to Trash: ${filePath}`, isError: false, durationMs: 0 };
    } catch (err) {
      return {
        output: `Failed to trash ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },
};

// ─── mac_search_spotlight ──────────────────────────────────────────────────

const SearchSpotlightInputSchema = z.object({
  query: z.string().min(1).describe("Search query for Spotlight"),
  directory: z.string().optional().describe("Limit search to a specific directory"),
  kind: z
    .enum(["any", "document", "image", "movie", "music", "pdf", "presentation", "folder"])
    .optional()
    .describe("Filter by file kind"),
  limit: z.number().int().positive().max(100).optional().default(20).describe("Max results (default 20)"),
});

export const macSearchSpotlightTool: ToolDefinitionRuntime = {
  name: "mac_search_spotlight",
  description:
    "Search files using macOS Spotlight (mdfind). Supports full-text search, directory scoping, and file kind filtering.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      directory: { type: "string", description: "Limit search to a specific directory" },
      kind: {
        type: "string",
        description: "Filter by file kind",
        enum: ["any", "document", "image", "movie", "music", "pdf", "presentation", "folder"],
      },
      limit: { type: "integer", description: "Max results (default 20)", minimum: 1, maximum: 100 },
    },
    required: ["query"],
  },
  inputSchema: SearchSpotlightInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 15_000,
  tags: ["macos", "finder", "search"],

  async execute(input: Record<string, unknown>): Promise<unknown> {
    assertMacOS();
    const parsed = SearchSpotlightInputSchema.parse(input);

    const args: string[] = [];

    // Add directory scope
    if (parsed.directory) {
      args.push("-onlyin", parsed.directory);
    }

    // Build the query
    let queryStr = parsed.query;
    if (parsed.kind && parsed.kind !== "any") {
      const kindMap: Record<string, string> = {
        document: "kMDItemContentTypeTree == public.text",
        image: "kMDItemContentTypeTree == public.image",
        movie: "kMDItemContentTypeTree == public.movie",
        music: "kMDItemContentTypeTree == public.audio",
        pdf: 'kMDItemContentType == "com.adobe.pdf"',
        presentation: 'kMDItemContentType == "com.microsoft.powerpoint.pptx" || kMDItemContentType == "com.apple.keynote.key"',
        folder: "kMDItemContentType == public.folder",
      };
      if (kindMap[parsed.kind]) {
        queryStr = `${kindMap[parsed.kind]} && kMDItemTextContent == "*${parsed.query}*"cd`;
      }
    }

    args.push(queryStr);

    const { stdout } = await runExecFile("mdfind", args, 15_000);
    const results = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, parsed.limit);

    return {
      output: results.length > 0 ? results.join("\n") : "No results found",
      isError: false,
      results,
      count: results.length,
    };
  },
};

// ─── Notes Tool ───────────────────────────────────────────────────────────

import { readFile, writeFile, readdir, unlink, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../registry.js";

const logger = pino({ name: "tool-notes" });

const NOTES_DIR = join(homedir(), ".karna", "notes");

// ─── Helpers ─────────────────────────────────────────────────────────────

function sanitizeTitle(title: string): string {
  // Convert to a safe filename: lowercase, replace spaces/special chars with dashes
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100);
}

function titleToPath(title: string): string {
  const safe = sanitizeTitle(title);
  if (!safe) throw new Error("Invalid note title: results in empty filename after sanitization");
  return join(NOTES_DIR, `${safe}.md`);
}

async function ensureNotesDir(): Promise<void> {
  await mkdir(NOTES_DIR, { recursive: true });
}

// ─── Create Note ─────────────────────────────────────────────────────────

const CreateNoteInputSchema = z.object({
  title: z.string().min(1).max(200).describe("Note title (used as filename)"),
  content: z.string().describe("Note content in markdown format"),
});

export const noteCreateTool: ToolDefinitionRuntime = {
  name: "note_create",
  description:
    "Create a new markdown note stored at ~/.karna/notes/. " +
    "The title is used as the filename.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Note title (used as filename)" },
      content: { type: "string", description: "Note content in markdown format" },
    },
    required: ["title", "content"],
  },
  inputSchema: CreateNoteInputSchema,
  riskLevel: "medium",
  requiresApproval: false,
  timeout: 5_000,
  tags: ["notes", "write", "create"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = CreateNoteInputSchema.parse(input);
    await ensureNotesDir();

    const filePath = titleToPath(parsed.title);

    // Check if note already exists
    try {
      await stat(filePath);
      throw new Error(`Note already exists: ${parsed.title}. Use note_update to modify it.`);
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
    }

    const fullContent = `# ${parsed.title}\n\n${parsed.content}`;
    await writeFile(filePath, fullContent, "utf-8");

    logger.info({ title: parsed.title, path: filePath }, "Note created");

    return {
      created: true,
      title: parsed.title,
      path: filePath,
      sizeBytes: Buffer.byteLength(fullContent, "utf-8"),
    };
  },
};

// ─── Read Note ───────────────────────────────────────────────────────────

const ReadNoteInputSchema = z.object({
  title: z.string().min(1).describe("Note title to read"),
});

export const noteReadTool: ToolDefinitionRuntime = {
  name: "note_read",
  description: "Read the contents of a note by its title.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Note title to read" },
    },
    required: ["title"],
  },
  inputSchema: ReadNoteInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 5_000,
  tags: ["notes", "read"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = ReadNoteInputSchema.parse(input);
    const filePath = titleToPath(parsed.title);

    const content = await readFile(filePath, "utf-8");

    return { title: parsed.title, path: filePath, content };
  },
};

// ─── Update Note ─────────────────────────────────────────────────────────

const UpdateNoteInputSchema = z.object({
  title: z.string().min(1).describe("Note title to update"),
  content: z.string().describe("New content for the note"),
});

export const noteUpdateTool: ToolDefinitionRuntime = {
  name: "note_update",
  description: "Update the content of an existing note. Replaces the entire content.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Note title to update" },
      content: { type: "string", description: "New content for the note" },
    },
    required: ["title", "content"],
  },
  inputSchema: UpdateNoteInputSchema,
  riskLevel: "medium",
  requiresApproval: false,
  timeout: 5_000,
  tags: ["notes", "write", "update"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = UpdateNoteInputSchema.parse(input);
    const filePath = titleToPath(parsed.title);

    // Verify note exists
    await stat(filePath);

    const fullContent = `# ${parsed.title}\n\n${parsed.content}`;
    await writeFile(filePath, fullContent, "utf-8");

    logger.info({ title: parsed.title }, "Note updated");

    return {
      updated: true,
      title: parsed.title,
      path: filePath,
      sizeBytes: Buffer.byteLength(fullContent, "utf-8"),
    };
  },
};

// ─── Delete Note ─────────────────────────────────────────────────────────

const DeleteNoteInputSchema = z.object({
  title: z.string().min(1).describe("Note title to delete"),
});

export const noteDeleteTool: ToolDefinitionRuntime = {
  name: "note_delete",
  description: "Permanently delete a note by its title.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Note title to delete" },
    },
    required: ["title"],
  },
  inputSchema: DeleteNoteInputSchema,
  riskLevel: "high",
  requiresApproval: true,
  timeout: 5_000,
  tags: ["notes", "write", "delete"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = DeleteNoteInputSchema.parse(input);
    const filePath = titleToPath(parsed.title);

    await unlink(filePath);

    logger.info({ title: parsed.title }, "Note deleted");

    return { deleted: true, title: parsed.title, path: filePath };
  },
};

// ─── List Notes ──────────────────────────────────────────────────────────

const ListNotesInputSchema = z.object({});

export const noteListTool: ToolDefinitionRuntime = {
  name: "note_list",
  description: "List all notes stored in ~/.karna/notes/.",
  parameters: {
    type: "object",
    properties: {},
  },
  inputSchema: ListNotesInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 5_000,
  tags: ["notes", "list"],

  async execute(
    _input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    await ensureNotesDir();

    const files = await readdir(NOTES_DIR);
    const notes = [];

    for (const file of files) {
      if (!file.endsWith(".md")) continue;

      const filePath = join(NOTES_DIR, file);
      const fileStat = await stat(filePath);

      notes.push({
        title: file.replace(/\.md$/, ""),
        path: filePath,
        sizeBytes: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
        createdAt: fileStat.birthtime.toISOString(),
      });
    }

    return { notes, totalNotes: notes.length };
  },
};

// ─── Search Notes ────────────────────────────────────────────────────────

const SearchNotesInputSchema = z.object({
  query: z.string().min(1).describe("Text to search for in note contents"),
});

export const noteSearchTool: ToolDefinitionRuntime = {
  name: "note_search",
  description:
    "Search across all notes for matching text content. " +
    "Returns matching notes with the matching line.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Text to search for in note contents" },
    },
    required: ["query"],
  },
  inputSchema: SearchNotesInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 10_000,
  tags: ["notes", "search"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = SearchNotesInputSchema.parse(input);
    await ensureNotesDir();

    const files = await readdir(NOTES_DIR);
    const queryLower = parsed.query.toLowerCase();
    const results: Array<{ title: string; path: string; matches: Array<{ line: number; content: string }> }> = [];

    for (const file of files) {
      if (!file.endsWith(".md")) continue;

      const filePath = join(NOTES_DIR, file);
      try {
        const content = await readFile(filePath, "utf-8");
        const lines = content.split("\n");
        const lineMatches: Array<{ line: number; content: string }> = [];

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(queryLower)) {
            lineMatches.push({ line: i + 1, content: lines[i].trim() });
          }
        }

        if (lineMatches.length > 0) {
          results.push({
            title: file.replace(/\.md$/, ""),
            path: filePath,
            matches: lineMatches,
          });
        }
      } catch {
        // Skip unreadable files
      }
    }

    return { query: parsed.query, results, totalResults: results.length };
  },
};

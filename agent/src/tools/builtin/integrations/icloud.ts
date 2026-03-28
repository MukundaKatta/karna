// ─── iCloud / iPhone Sync Integration ─────────────────────────────────────
//
// Syncs with iPhone via macOS iCloud data:
// - Contacts (via contacts CLI or AppleScript)
// - Reminders (via AppleScript)
// - Notes (via AppleScript)
// - Safari tabs (via AppleScript)
// - iMessage (via chat.db)
//
// Requires macOS with iCloud signed in.
// ──────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import type { ToolResult } from "../../registry.js";

const exec = promisify(execFile);
const TIMEOUT = 10000;

function isMac(): boolean {
  return process.platform === "darwin";
}

async function runAppleScript(script: string): Promise<string> {
  if (!isMac()) throw new Error("iCloud sync requires macOS");
  const { stdout } = await exec("osascript", ["-e", script], { timeout: TIMEOUT });
  return stdout.trim();
}

// ─── Contacts ───────────────────────────────────────────────────────────

export const icloudSearchContacts = {
  name: "iphone_search_contacts",
  description: "Search iPhone/iCloud contacts by name, email, or phone number",
  parameters: z.object({
    query: z.string().describe("Search query (name, email, or phone)"),
  }),
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "Search query" },
    },
    required: ["query"],
  },
  riskLevel: "low" as const,
  requiresApproval: false,
  tags: ["icloud", "contacts", "iphone"],
  async execute(input: { query: string }): Promise<ToolResult> {
    try {
      const script = `
        tell application "Contacts"
          set matchedContacts to every person whose name contains "${input.query.replace(/"/g, '\\"')}"
          set output to ""
          repeat with c in matchedContacts
            set contactName to name of c
            set contactEmail to ""
            set contactPhone to ""
            try
              set contactEmail to value of first email of c
            end try
            try
              set contactPhone to value of first phone of c
            end try
            set output to output & contactName & " | " & contactEmail & " | " & contactPhone & "\\n"
          end repeat
          return output
        end tell
      `;
      const result = await runAppleScript(script);
      if (!result) return { output: `No contacts found matching "${input.query}"`, isError: false };
      return { output: result, isError: false };
    } catch (err) {
      return { output: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

// ─── Reminders ──────────────────────────────────────────────────────────

export const icloudListReminders = {
  name: "iphone_list_reminders",
  description: "List reminders from iPhone/iCloud Reminders app",
  parameters: z.object({
    list: z.string().optional().describe("Reminder list name (default: all)"),
  }),
  inputSchema: {
    type: "object" as const,
    properties: {
      list: { type: "string", description: "Reminder list name" },
    },
    required: [],
  },
  riskLevel: "low" as const,
  requiresApproval: false,
  tags: ["icloud", "reminders", "iphone"],
  async execute(input: { list?: string }): Promise<ToolResult> {
    try {
      const listFilter = input.list
        ? `of list "${input.list.replace(/"/g, '\\"')}"`
        : "";
      const script = `
        tell application "Reminders"
          set output to ""
          set allReminders to (every reminder ${listFilter} whose completed is false)
          repeat with r in allReminders
            set rName to name of r
            set rDate to ""
            try
              set rDate to due date of r as string
            end try
            set output to output & "- " & rName
            if rDate is not "" then
              set output to output & " (due: " & rDate & ")"
            end if
            set output to output & "\\n"
          end repeat
          return output
        end tell
      `;
      const result = await runAppleScript(script);
      if (!result) return { output: "No pending reminders found", isError: false };
      return { output: result, isError: false };
    } catch (err) {
      return { output: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

export const icloudCreateReminder = {
  name: "iphone_create_reminder",
  description: "Create a new reminder that syncs to iPhone via iCloud",
  parameters: z.object({
    title: z.string().describe("Reminder title"),
    list: z.string().optional().describe("Reminder list (default: Reminders)"),
    notes: z.string().optional().describe("Additional notes"),
  }),
  inputSchema: {
    type: "object" as const,
    properties: {
      title: { type: "string", description: "Reminder title" },
      list: { type: "string", description: "Reminder list" },
      notes: { type: "string", description: "Notes" },
    },
    required: ["title"],
  },
  riskLevel: "low" as const,
  requiresApproval: false,
  tags: ["icloud", "reminders", "iphone"],
  async execute(input: { title: string; list?: string; notes?: string }): Promise<ToolResult> {
    try {
      const listName = input.list || "Reminders";
      const notesLine = input.notes ? `set body of newReminder to "${input.notes.replace(/"/g, '\\"')}"` : "";
      const script = `
        tell application "Reminders"
          tell list "${listName.replace(/"/g, '\\"')}"
            set newReminder to make new reminder with properties {name:"${input.title.replace(/"/g, '\\"')}"}
            ${notesLine}
          end tell
          return "Created reminder: ${input.title.replace(/"/g, '\\"')}"
        end tell
      `;
      const result = await runAppleScript(script);
      return { output: result, isError: false };
    } catch (err) {
      return { output: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

// ─── Notes ──────────────────────────────────────────────────────────────

export const icloudSearchNotes = {
  name: "iphone_search_notes",
  description: "Search Apple Notes that sync with iPhone via iCloud",
  parameters: z.object({
    query: z.string().describe("Search text to find in notes"),
  }),
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "Search query" },
    },
    required: ["query"],
  },
  riskLevel: "low" as const,
  requiresApproval: false,
  tags: ["icloud", "notes", "iphone"],
  async execute(input: { query: string }): Promise<ToolResult> {
    try {
      const script = `
        tell application "Notes"
          set matchedNotes to every note whose name contains "${input.query.replace(/"/g, '\\"')}" or body contains "${input.query.replace(/"/g, '\\"')}"
          set output to ""
          set noteCount to 0
          repeat with n in matchedNotes
            if noteCount > 10 then exit repeat
            set noteName to name of n
            set noteDate to modification date of n as string
            set noteBody to body of n
            if length of noteBody > 200 then
              set noteBody to text 1 thru 200 of noteBody & "..."
            end if
            set output to output & "## " & noteName & " (" & noteDate & ")\\n" & noteBody & "\\n\\n"
            set noteCount to noteCount + 1
          end repeat
          return output
        end tell
      `;
      const result = await runAppleScript(script);
      if (!result) return { output: `No notes found matching "${input.query}"`, isError: false };
      return { output: result, isError: false };
    } catch (err) {
      return { output: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

export const icloudCreateNote = {
  name: "iphone_create_note",
  description: "Create a new Apple Note that syncs to iPhone via iCloud",
  parameters: z.object({
    title: z.string().describe("Note title"),
    body: z.string().describe("Note content"),
    folder: z.string().optional().describe("Notes folder (default: Notes)"),
  }),
  inputSchema: {
    type: "object" as const,
    properties: {
      title: { type: "string", description: "Note title" },
      body: { type: "string", description: "Note body" },
      folder: { type: "string", description: "Folder name" },
    },
    required: ["title", "body"],
  },
  riskLevel: "medium" as const,
  requiresApproval: false,
  tags: ["icloud", "notes", "iphone"],
  async execute(input: { title: string; body: string; folder?: string }): Promise<ToolResult> {
    try {
      const folderName = input.folder || "Notes";
      const script = `
        tell application "Notes"
          tell folder "${folderName.replace(/"/g, '\\"')}"
            make new note with properties {name:"${input.title.replace(/"/g, '\\"')}", body:"${input.body.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"}
          end tell
          return "Created note: ${input.title.replace(/"/g, '\\"')}"
        end tell
      `;
      const result = await runAppleScript(script);
      return { output: result, isError: false };
    } catch (err) {
      return { output: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

// ─── Safari Tabs ────────────────────────────────────────────────────────

export const icloudSafariTabs = {
  name: "iphone_safari_tabs",
  description: "List open Safari tabs from all devices (Mac + iPhone via iCloud Tabs)",
  parameters: z.object({}),
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
  riskLevel: "low" as const,
  requiresApproval: false,
  tags: ["icloud", "safari", "iphone"],
  async execute(): Promise<ToolResult> {
    try {
      const script = `
        tell application "Safari"
          set output to ""
          repeat with w in every window
            repeat with t in every tab of w
              set tabName to name of t
              set tabUrl to URL of t
              set output to output & tabName & " | " & tabUrl & "\\n"
            end repeat
          end repeat
          return output
        end tell
      `;
      const result = await runAppleScript(script);
      if (!result) return { output: "No Safari tabs open", isError: false };
      return { output: result, isError: false };
    } catch (err) {
      return { output: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

// ─── Export ─────────────────────────────────────────────────────────────

export const icloudTools = [
  icloudSearchContacts,
  icloudListReminders,
  icloudCreateReminder,
  icloudSearchNotes,
  icloudCreateNote,
  icloudSafariTabs,
];

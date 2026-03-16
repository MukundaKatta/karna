// ─── Reminders Tool ───────────────────────────────────────────────────────

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../registry.js";

const logger = pino({ name: "tool-reminder" });

const KARNA_DIR = join(homedir(), ".karna");
const REMINDERS_FILE = join(KARNA_DIR, "reminders.json");

// ─── Reminder Store ──────────────────────────────────────────────────────

interface Reminder {
  id: string;
  message: string;
  triggerAt: string; // ISO 8601
  createdAt: string;
  fired: boolean;
}

const activeTimers = new Map<string, NodeJS.Timeout>();

async function loadReminders(): Promise<Reminder[]> {
  try {
    const data = await readFile(REMINDERS_FILE, "utf-8");
    return JSON.parse(data) as Reminder[];
  } catch {
    return [];
  }
}

async function saveReminders(reminders: Reminder[]): Promise<void> {
  await mkdir(KARNA_DIR, { recursive: true });
  await writeFile(REMINDERS_FILE, JSON.stringify(reminders, null, 2), "utf-8");
}

function scheduleTimer(reminder: Reminder): void {
  const delay = new Date(reminder.triggerAt).getTime() - Date.now();
  if (delay <= 0 || reminder.fired) return;

  const timer = setTimeout(async () => {
    logger.info({ id: reminder.id, message: reminder.message }, "Reminder triggered");
    reminder.fired = true;
    activeTimers.delete(reminder.id);

    // Persist the fired state
    try {
      const reminders = await loadReminders();
      const idx = reminders.findIndex((r) => r.id === reminder.id);
      if (idx >= 0) {
        reminders[idx].fired = true;
        await saveReminders(reminders);
      }
    } catch (err) {
      logger.error({ err, id: reminder.id }, "Failed to persist reminder fired state");
    }
  }, delay);

  // Prevent the timer from keeping the process alive
  timer.unref();
  activeTimers.set(reminder.id, timer);
}

// ─── Set Reminder ────────────────────────────────────────────────────────

const SetReminderInputSchema = z.object({
  message: z.string().min(1).max(1000).describe("Reminder message"),
  triggerAt: z.string().describe("When to trigger the reminder (ISO 8601 datetime)"),
});

export const reminderSetTool: ToolDefinitionRuntime = {
  name: "reminder_set",
  description:
    "Set a reminder that triggers at a specific time. " +
    "The reminder is persisted to disk and scheduled in-process.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "Reminder message" },
      triggerAt: {
        type: "string",
        description: "When to trigger the reminder (ISO 8601 datetime)",
      },
    },
    required: ["message", "triggerAt"],
  },
  inputSchema: SetReminderInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 5_000,
  tags: ["reminder", "schedule"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = SetReminderInputSchema.parse(input);

    const triggerDate = new Date(parsed.triggerAt);
    if (isNaN(triggerDate.getTime())) {
      throw new Error(`Invalid date: ${parsed.triggerAt}`);
    }

    if (triggerDate.getTime() <= Date.now()) {
      throw new Error("Reminder trigger time must be in the future");
    }

    const reminder: Reminder = {
      id: randomUUID(),
      message: parsed.message,
      triggerAt: triggerDate.toISOString(),
      createdAt: new Date().toISOString(),
      fired: false,
    };

    const reminders = await loadReminders();
    reminders.push(reminder);
    await saveReminders(reminders);

    scheduleTimer(reminder);

    logger.info({ id: reminder.id, triggerAt: reminder.triggerAt }, "Reminder set");

    return {
      id: reminder.id,
      message: reminder.message,
      triggerAt: reminder.triggerAt,
      createdAt: reminder.createdAt,
    };
  },
};

// ─── List Reminders ──────────────────────────────────────────────────────

const ListRemindersInputSchema = z.object({
  includeExpired: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include already-fired reminders"),
});

export const reminderListTool: ToolDefinitionRuntime = {
  name: "reminder_list",
  description: "List all scheduled reminders, optionally including expired ones.",
  parameters: {
    type: "object",
    properties: {
      includeExpired: {
        type: "boolean",
        description: "Include already-fired reminders",
      },
    },
  },
  inputSchema: ListRemindersInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 5_000,
  tags: ["reminder", "list"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = ListRemindersInputSchema.parse(input);
    let reminders = await loadReminders();

    if (!parsed.includeExpired) {
      reminders = reminders.filter((r) => !r.fired);
    }

    return {
      reminders: reminders.map((r) => ({
        id: r.id,
        message: r.message,
        triggerAt: r.triggerAt,
        createdAt: r.createdAt,
        fired: r.fired,
      })),
      totalReminders: reminders.length,
    };
  },
};

// ─── Cancel Reminder ─────────────────────────────────────────────────────

const CancelReminderInputSchema = z.object({
  id: z.string().min(1).describe("The reminder ID to cancel"),
});

export const reminderCancelTool: ToolDefinitionRuntime = {
  name: "reminder_cancel",
  description: "Cancel a scheduled reminder by its ID.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "The reminder ID to cancel" },
    },
    required: ["id"],
  },
  inputSchema: CancelReminderInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 5_000,
  tags: ["reminder", "cancel"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = CancelReminderInputSchema.parse(input);

    const reminders = await loadReminders();
    const idx = reminders.findIndex((r) => r.id === parsed.id);

    if (idx < 0) {
      throw new Error(`Reminder not found: ${parsed.id}`);
    }

    // Clear in-memory timer
    const timer = activeTimers.get(parsed.id);
    if (timer) {
      clearTimeout(timer);
      activeTimers.delete(parsed.id);
    }

    reminders.splice(idx, 1);
    await saveReminders(reminders);

    logger.info({ id: parsed.id }, "Reminder cancelled");

    return { cancelled: true, id: parsed.id };
  },
};

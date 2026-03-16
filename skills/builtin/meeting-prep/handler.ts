// ─── Meeting Prep Skill Handler ───────────────────────────────────────────
//
// Prepares context for upcoming meetings by gathering attendee info,
// searching emails and notes for relevant history, and generating
// a concise prep summary.
//
// ───────────────────────────────────────────────────────────────────────────

import pino from "pino";
import type {
  SkillHandler,
  SkillContext,
  SkillResult,
} from "../../../agent/src/skills/loader.js";

const logger = pino({ name: "skill:meeting-prep" });

// ─── Types ──────────────────────────────────────────────────────────────────

interface Meeting {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  location?: string;
  meetingLink?: string;
  description?: string;
  attendees: Attendee[];
}

interface Attendee {
  name: string;
  email: string;
  role?: string;
  lastInteraction?: string;
}

interface ContextItem {
  type: "email" | "note" | "action-item";
  title: string;
  summary: string;
  date: string;
  source: string;
}

interface PrepSummary {
  meeting: Meeting;
  context: ContextItem[];
  preparedAt: string;
}

// ─── Handler ────────────────────────────────────────────────────────────────

const PREP_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

export class MeetingPrepHandler implements SkillHandler {
  private preppedMeetings: Set<string> = new Set();

  async initialize(context: SkillContext): Promise<void> {
    logger.info({ sessionId: context.sessionId }, "Meeting prep skill initialized");
  }

  async execute(
    action: string,
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    logger.debug({ action, sessionId: context.sessionId }, "Executing meeting prep action");

    try {
      switch (action) {
        case "prepare":
          return this.prepareMeeting(input, context);
        case "attendees":
          return this.getAttendees(input, context);
        case "context":
          return this.searchContext(input, context);
        default:
          return {
            success: false,
            output: `Unknown action: ${action}`,
            error: `Action "${action}" is not supported`,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, action }, "Meeting prep action failed");
      return { success: false, output: `Failed: ${message}`, error: message };
    }
  }

  async dispose(): Promise<void> {
    this.preppedMeetings.clear();
    logger.info("Meeting prep skill disposed");
  }

  // ─── Actions ────────────────────────────────────────────────────────────

  private async prepareMeeting(
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    const isHeartbeat = input["trigger"] === "heartbeat";
    const meetingId = input["meetingId"] as string | undefined;

    // Fetch upcoming meetings
    const meetings = await this.fetchUpcomingMeetings(context);

    if (meetings.length === 0) {
      return {
        success: true,
        output: "No upcoming meetings found in the next 2 hours.",
      };
    }

    // Select meeting to prep
    let target: Meeting | undefined;
    if (meetingId) {
      target = meetings.find((m) => m.id === meetingId);
      if (!target) {
        return {
          success: false,
          output: `Meeting with ID "${meetingId}" not found in upcoming events.`,
          error: "Meeting not found",
        };
      }
    } else {
      // Pick the soonest un-prepped meeting
      target = meetings.find((m) => !this.preppedMeetings.has(m.id));
      if (!target && isHeartbeat) {
        return {
          success: true,
          output: "All upcoming meetings have already been prepped.",
          data: { skipped: true },
        };
      }
      target = target ?? meetings[0];
    }

    if (!target) {
      return { success: true, output: "No meetings to prepare for." };
    }

    // Gather context
    const contextItems = await this.gatherContext(target, context);

    // Mark as prepped
    this.preppedMeetings.add(target.id);

    const summary: PrepSummary = {
      meeting: target,
      context: contextItems,
      preparedAt: new Date().toISOString(),
    };

    return {
      success: true,
      output: this.formatPrepSummary(summary),
      data: summary as unknown as Record<string, unknown>,
    };
  }

  private async getAttendees(
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    const meetingId = input["meetingId"] as string | undefined;
    const meetings = await this.fetchUpcomingMeetings(context);

    const meeting = meetingId
      ? meetings.find((m) => m.id === meetingId)
      : meetings[0];

    if (!meeting) {
      return {
        success: true,
        output: "No meeting found to get attendees for.",
      };
    }

    if (meeting.attendees.length === 0) {
      return {
        success: true,
        output: `Meeting "${meeting.title}" has no listed attendees.`,
      };
    }

    const lines = meeting.attendees.map((a) => {
      let line = `• ${a.name} (${a.email})`;
      if (a.role) line += ` — ${a.role}`;
      if (a.lastInteraction) line += ` | Last contact: ${a.lastInteraction}`;
      return line;
    });

    return {
      success: true,
      output: `Attendees for "${meeting.title}":\n${lines.join("\n")}`,
      data: { attendees: meeting.attendees } as unknown as Record<string, unknown>,
    };
  }

  private async searchContext(
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    const topic = (input["topic"] as string) ?? "";
    if (!topic) {
      return {
        success: false,
        output: "Please provide a topic to search context for.",
        error: "Missing topic",
      };
    }

    const contextItems = await this.searchEmailsAndNotes(topic, context);

    if (contextItems.length === 0) {
      return {
        success: true,
        output: `No relevant context found for topic: "${topic}".`,
      };
    }

    const lines = contextItems.map(
      (item) =>
        `[${item.type}] ${item.title}\n  ${item.date} | ${item.source}\n  ${item.summary}`
    );

    return {
      success: true,
      output: `Context for "${topic}" (${contextItems.length} items):\n\n${lines.join("\n\n")}`,
      data: { context: contextItems } as unknown as Record<string, unknown>,
    };
  }

  // ─── Data Fetching (Stubs) ─────────────────────────────────────────────

  private async fetchUpcomingMeetings(
    _context: SkillContext
  ): Promise<Meeting[]> {
    // In production, calls calendar_list tool filtered to the next 2 hours.
    logger.debug("Fetching upcoming meetings from calendar");

    // Stub: return empty until calendar tool is wired
    return [];
  }

  private async gatherContext(
    meeting: Meeting,
    context: SkillContext
  ): Promise<ContextItem[]> {
    const items: ContextItem[] = [];

    // Search by meeting title
    const titleContext = await this.searchEmailsAndNotes(meeting.title, context);
    items.push(...titleContext);

    // Search by attendee names
    for (const attendee of meeting.attendees) {
      const attendeeContext = await this.searchEmailsAndNotes(
        attendee.name,
        context
      );
      items.push(...attendeeContext);
    }

    // Deduplicate by title
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.title)) return false;
      seen.add(item.title);
      return true;
    });
  }

  private async searchEmailsAndNotes(
    query: string,
    _context: SkillContext
  ): Promise<ContextItem[]> {
    // In production, calls email_search tool and notes search.
    logger.debug({ query }, "Searching emails and notes for context");

    // Stub: return empty until email/notes tools are wired
    return [];
  }

  // ─── Formatting ────────────────────────────────────────────────────────

  private formatPrepSummary(summary: PrepSummary): string {
    const { meeting, context: contextItems } = summary;
    const sections: string[] = [];

    // Header
    sections.push(`Meeting Prep: ${meeting.title}`);
    sections.push(`${"─".repeat(50)}\n`);

    // Meeting details
    sections.push("**Details**");
    sections.push(`• Time: ${meeting.startTime} - ${meeting.endTime}`);
    if (meeting.location) sections.push(`• Location: ${meeting.location}`);
    if (meeting.meetingLink) sections.push(`• Link: ${meeting.meetingLink}`);
    sections.push("");

    // Attendees
    if (meeting.attendees.length > 0) {
      sections.push(`**Attendees** (${meeting.attendees.length})`);
      for (const attendee of meeting.attendees) {
        let line = `• ${attendee.name}`;
        if (attendee.role) line += ` — ${attendee.role}`;
        sections.push(line);
      }
      sections.push("");
    }

    // Agenda
    if (meeting.description) {
      sections.push("**Agenda**");
      sections.push(meeting.description);
      sections.push("");
    }

    // Context
    if (contextItems.length > 0) {
      sections.push(`**Relevant Context** (${contextItems.length} items)`);
      for (const item of contextItems.slice(0, 5)) {
        sections.push(`• [${item.type}] ${item.title} — ${item.summary}`);
      }
      if (contextItems.length > 5) {
        sections.push(`  ... and ${contextItems.length - 5} more items`);
      }
    } else {
      sections.push("**Context** — No relevant emails or notes found");
    }

    return sections.join("\n");
  }
}

export default MeetingPrepHandler;

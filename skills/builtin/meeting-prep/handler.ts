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
  actionItems: string[];
  suggestedAgenda: string[];
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
    const meetingTitle = input["title"] as string | undefined;
    const meetingDescription = input["description"] as string | undefined;

    // Fetch upcoming meetings
    const meetings = await this.fetchUpcomingMeetings(context);

    // If a title/description was provided directly (no calendar), create an ad-hoc meeting
    if (meetings.length === 0 && meetingTitle) {
      const adHocMeeting: Meeting = {
        id: `adhoc-${Date.now()}`,
        title: meetingTitle,
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        description: meetingDescription,
        attendees: this.parseAttendeesFromInput(input),
      };

      const contextItems = await this.gatherContext(adHocMeeting, context);
      const actionItems = this.extractActionItems(contextItems);
      const suggestedAgenda = this.buildSuggestedAgenda(adHocMeeting, contextItems);

      const summary: PrepSummary = {
        meeting: adHocMeeting,
        context: contextItems,
        actionItems,
        suggestedAgenda,
        preparedAt: new Date().toISOString(),
      };

      return {
        success: true,
        output: this.formatPrepSummary(summary),
        data: summary as unknown as Record<string, unknown>,
      };
    }

    if (meetings.length === 0) {
      return {
        success: true,
        output: "No upcoming meetings found in the next 2 hours. Provide a meeting title to prep manually.",
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
    const actionItems = this.extractActionItems(contextItems);
    const suggestedAgenda = this.buildSuggestedAgenda(target, contextItems);

    // Mark as prepped
    this.preppedMeetings.add(target.id);

    const summary: PrepSummary = {
      meeting: target,
      context: contextItems,
      actionItems,
      suggestedAgenda,
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

    // Enrich attendees with last interaction data from email
    const enriched = await this.enrichAttendees(meeting.attendees, context);

    const lines = enriched.map((a) => {
      let line = `- ${a.name} (${a.email})`;
      if (a.role) line += ` -- ${a.role}`;
      if (a.lastInteraction) line += ` | Last contact: ${a.lastInteraction}`;
      return line;
    });

    return {
      success: true,
      output: `Attendees for "${meeting.title}":\n${lines.join("\n")}`,
      data: { attendees: enriched } as unknown as Record<string, unknown>,
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

  // ─── Data Fetching ────────────────────────────────────────────────────

  private async fetchUpcomingMeetings(
    context: SkillContext
  ): Promise<Meeting[]> {
    logger.debug("Fetching upcoming meetings from calendar");

    if (!context.callTool) {
      logger.debug("No callTool available — calendar tool not connected");
      return [];
    }

    try {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + PREP_WINDOW_MS);

      const result = await context.callTool("calendar_list", {
        timeMin: now.toISOString(),
        timeMax: windowEnd.toISOString(),
      });

      if (!result || typeof result !== "object") return [];

      const events = Array.isArray(result)
        ? result
        : Array.isArray((result as Record<string, unknown>)["events"])
          ? (result as { events: unknown[] }).events
          : [];

      const meetings: Meeting[] = [];

      for (const evt of events) {
        if (!evt || typeof evt !== "object") continue;
        const e = evt as Record<string, unknown>;

        const attendeesRaw = (e["attendees"] as Array<Record<string, unknown>>) ?? [];
        const attendees: Attendee[] = attendeesRaw.map((a) => ({
          name: (a["name"] as string) ?? (a["displayName"] as string) ?? (a["email"] as string) ?? "Unknown",
          email: (a["email"] as string) ?? "",
          role: (a["organizer"] as boolean) ? "Organizer" : undefined,
        }));

        const startRaw = e["start"] ?? e["startTime"] ?? "";
        const endRaw = e["end"] ?? e["endTime"] ?? "";

        // Extract meeting link from description or dedicated field
        let meetingLink = (e["hangoutLink"] as string) ?? (e["conferenceLink"] as string);
        if (!meetingLink && e["description"]) {
          const desc = e["description"] as string;
          const linkMatch = desc.match(/https?:\/\/[^\s<>"]+(?:meet|zoom|teams)[^\s<>"]*/i);
          if (linkMatch) meetingLink = linkMatch[0];
        }

        meetings.push({
          id: (e["id"] as string) ?? `evt-${Date.now()}-${meetings.length}`,
          title: (e["summary"] as string) ?? (e["title"] as string) ?? "Untitled Meeting",
          startTime: this.extractTimeStr(startRaw),
          endTime: this.extractTimeStr(endRaw),
          location: (e["location"] as string) ?? undefined,
          meetingLink,
          description: (e["description"] as string) ?? undefined,
          attendees,
        });
      }

      // Sort by start time
      meetings.sort((a, b) => a.startTime.localeCompare(b.startTime));

      return meetings;
    } catch (error) {
      logger.warn({ error: String(error) }, "Failed to fetch calendar events");
      return [];
    }
  }

  private async gatherContext(
    meeting: Meeting,
    context: SkillContext
  ): Promise<ContextItem[]> {
    const items: ContextItem[] = [];

    // Search by meeting title
    const titleContext = await this.searchEmailsAndNotes(meeting.title, context);
    items.push(...titleContext);

    // Search by attendee names (limit to first 5 to avoid excessive queries)
    for (const attendee of meeting.attendees.slice(0, 5)) {
      if (attendee.email) {
        const attendeeContext = await this.searchEmailsAndNotes(
          attendee.email,
          context
        );
        items.push(...attendeeContext);
      }
    }

    // Search by meeting description keywords
    if (meeting.description) {
      const keywords = this.extractKeywords(meeting.description);
      if (keywords) {
        const descContext = await this.searchEmailsAndNotes(keywords, context);
        items.push(...descContext);
      }
    }

    // Deduplicate by title
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = item.title.toLowerCase().slice(0, 80);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async searchEmailsAndNotes(
    query: string,
    context: SkillContext
  ): Promise<ContextItem[]> {
    logger.debug({ query }, "Searching emails and notes for context");

    if (!context.callTool) {
      logger.debug("No callTool available — email/notes tools not connected");
      return [];
    }

    const items: ContextItem[] = [];

    // Search emails
    try {
      const emailResult = await context.callTool("email_search", {
        query,
        maxResults: 5,
        dateRange: "30d", // Last 30 days
      });

      if (emailResult && typeof emailResult === "object") {
        const messages = Array.isArray(emailResult)
          ? emailResult
          : Array.isArray((emailResult as Record<string, unknown>)["messages"])
            ? (emailResult as { messages: unknown[] }).messages
            : [];

        for (const msg of messages) {
          if (!msg || typeof msg !== "object") continue;
          const m = msg as Record<string, unknown>;
          items.push({
            type: "email",
            title: (m["subject"] as string) ?? "No subject",
            summary: this.truncate((m["snippet"] as string) ?? (m["body"] as string) ?? "", 150),
            date: (m["date"] as string) ?? new Date().toISOString(),
            source: `From: ${(m["from"] as string) ?? "unknown"}`,
          });
        }
      }
    } catch (error) {
      logger.debug({ query, error: String(error) }, "Email search failed or not available");
    }

    // Try notes search if available
    try {
      const notesResult = await context.callTool("notes_search", {
        query,
        maxResults: 3,
      });

      if (notesResult && typeof notesResult === "object") {
        const notes = Array.isArray(notesResult)
          ? notesResult
          : Array.isArray((notesResult as Record<string, unknown>)["notes"])
            ? (notesResult as { notes: unknown[] }).notes
            : [];

        for (const note of notes) {
          if (!note || typeof note !== "object") continue;
          const n = note as Record<string, unknown>;
          items.push({
            type: "note",
            title: (n["title"] as string) ?? "Untitled note",
            summary: this.truncate((n["content"] as string) ?? (n["body"] as string) ?? "", 150),
            date: (n["date"] as string) ?? (n["modifiedAt"] as string) ?? "",
            source: "Notes",
          });
        }
      }
    } catch {
      // Notes tool may not be available — that's fine
    }

    return items;
  }

  private async enrichAttendees(
    attendees: Attendee[],
    context: SkillContext
  ): Promise<Attendee[]> {
    if (!context.callTool) return attendees;

    const enriched: Attendee[] = [];
    for (const attendee of attendees) {
      const copy = { ...attendee };

      // Try to find last email interaction with this person
      try {
        const emailResult = await context.callTool("email_search", {
          query: `from:${attendee.email} OR to:${attendee.email}`,
          maxResults: 1,
        });

        if (emailResult && typeof emailResult === "object") {
          const messages = Array.isArray(emailResult)
            ? emailResult
            : Array.isArray((emailResult as Record<string, unknown>)["messages"])
              ? (emailResult as { messages: unknown[] }).messages
              : [];

          const latest = messages[0] as Record<string, unknown> | undefined;
          if (latest?.["date"]) {
            copy.lastInteraction = String(latest["date"]).split("T")[0] ?? undefined;
          }
        }
      } catch {
        // Email search may fail — that's fine
      }

      enriched.push(copy);
    }

    return enriched;
  }

  // ─── Analysis Helpers ─────────────────────────────────────────────────

  private extractActionItems(contextItems: ContextItem[]): string[] {
    const actionItems: string[] = [];
    const actionPatterns = [
      /action\s*items?:\s*(.+)/gi,
      /TODO:\s*(.+)/gi,
      /follow[- ]up:\s*(.+)/gi,
      /next\s*steps?:\s*(.+)/gi,
    ];

    for (const item of contextItems) {
      for (const pattern of actionPatterns) {
        const regex = new RegExp(pattern.source, pattern.flags);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(item.summary)) !== null) {
          if (match[1]) {
            actionItems.push(match[1].trim());
          }
        }
      }
    }

    return [...new Set(actionItems)].slice(0, 10);
  }

  private buildSuggestedAgenda(
    meeting: Meeting,
    contextItems: ContextItem[]
  ): string[] {
    const agenda: string[] = [];

    // Always start with opening/check-in
    agenda.push("Opening and check-in");

    // Add items from description
    if (meeting.description) {
      const bullets = meeting.description
        .split(/\n/)
        .filter((line) => line.match(/^[\s]*[-*]\s+/))
        .map((line) => line.replace(/^[\s]*[-*]\s+/, "").trim())
        .filter((line) => line.length > 0);
      agenda.push(...bullets.slice(0, 5));
    }

    // If there are action items from context, add a review section
    const actionItems = this.extractActionItems(contextItems);
    if (actionItems.length > 0) {
      agenda.push("Review open action items");
    }

    // Add discussion section based on meeting title
    if (agenda.length <= 2) {
      agenda.push(`Discussion: ${meeting.title}`);
    }

    // Always end with next steps
    agenda.push("Next steps and action items");
    agenda.push("Wrap-up");

    return agenda;
  }

  private extractKeywords(text: string): string {
    // Remove HTML, URLs, and common stop words, take top meaningful words
    const cleaned = text
      .replace(/<[^>]+>/g, " ")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^a-zA-Z0-9\s]/g, " ")
      .toLowerCase();

    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "shall", "can", "this", "that", "these",
      "those", "it", "its", "of", "in", "to", "for", "with", "on", "at",
      "by", "from", "as", "into", "about", "between", "through", "and",
      "but", "or", "not", "no", "if", "then", "else", "when", "while",
      "so", "we", "you", "they", "he", "she", "our", "your", "their",
    ]);

    const words = cleaned
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w));

    return words.slice(0, 5).join(" ");
  }

  private parseAttendeesFromInput(input: Record<string, unknown>): Attendee[] {
    const raw = input["attendees"];
    if (!raw || !Array.isArray(raw)) return [];

    return raw.map((a) => {
      if (typeof a === "string") {
        return { name: a, email: a.includes("@") ? a : "" };
      }
      if (typeof a === "object" && a !== null) {
        const obj = a as Record<string, unknown>;
        return {
          name: (obj["name"] as string) ?? (obj["email"] as string) ?? "Unknown",
          email: (obj["email"] as string) ?? "",
          role: obj["role"] as string | undefined,
        };
      }
      return { name: String(a), email: "" };
    });
  }

  // ─── Formatting ────────────────────────────────────────────────────────

  private formatPrepSummary(summary: PrepSummary): string {
    const { meeting, context: contextItems, actionItems, suggestedAgenda } = summary;
    const sections: string[] = [];

    // Header
    sections.push(`Meeting Prep: ${meeting.title}`);
    sections.push(`${"=".repeat(50)}\n`);

    // Meeting details
    sections.push("**Details**");
    sections.push(`- Time: ${meeting.startTime} - ${meeting.endTime}`);
    if (meeting.location) sections.push(`- Location: ${meeting.location}`);
    if (meeting.meetingLink) sections.push(`- Link: ${meeting.meetingLink}`);
    sections.push("");

    // Attendees
    if (meeting.attendees.length > 0) {
      sections.push(`**Attendees** (${meeting.attendees.length})`);
      for (const attendee of meeting.attendees) {
        let line = `- ${attendee.name}`;
        if (attendee.email) line += ` <${attendee.email}>`;
        if (attendee.role) line += ` -- ${attendee.role}`;
        if (attendee.lastInteraction) line += ` | Last contact: ${attendee.lastInteraction}`;
        sections.push(line);
      }
      sections.push("");
    }

    // Suggested agenda
    if (suggestedAgenda.length > 0) {
      sections.push("**Suggested Agenda**");
      suggestedAgenda.forEach((item, i) => {
        sections.push(`  ${i + 1}. ${item}`);
      });
      sections.push("");
    }

    // Agenda from description
    if (meeting.description) {
      sections.push("**Meeting Description**");
      sections.push(this.truncate(meeting.description, 500));
      sections.push("");
    }

    // Context
    if (contextItems.length > 0) {
      sections.push(`**Relevant Context** (${contextItems.length} items)`);
      for (const item of contextItems.slice(0, 8)) {
        sections.push(`- [${item.type}] ${item.title} -- ${item.summary}`);
      }
      if (contextItems.length > 8) {
        sections.push(`  ... and ${contextItems.length - 8} more items`);
      }
      sections.push("");
    } else {
      sections.push("**Context** -- No relevant emails or notes found\n");
    }

    // Action items
    if (actionItems.length > 0) {
      sections.push("**Open Action Items**");
      for (const item of actionItems) {
        sections.push(`- [ ] ${item}`);
      }
    }

    return sections.join("\n");
  }

  // ─── Utility ──────────────────────────────────────────────────────────

  private extractTimeStr(raw: unknown): string {
    if (!raw) return "??:??";
    if (typeof raw === "string") {
      try {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) {
          return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
        }
      } catch { /* fall through */ }
      return raw;
    }
    if (typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      const dateTime = obj["dateTime"] ?? obj["date"];
      if (dateTime) return this.extractTimeStr(dateTime);
    }
    return String(raw);
  }

  private truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 3) + "...";
  }
}

export default MeetingPrepHandler;

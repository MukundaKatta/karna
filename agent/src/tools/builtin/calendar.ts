// ─── Google Calendar Tool ──────────────────────────────────────────────────

import { z } from "zod";
import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../registry.js";

const logger = pino({ name: "tool-calendar" });

// ─── Auth Helper ─────────────────────────────────────────────────────────

async function getCalendarClient() {
  const { google } = await import("googleapis");
  const { GoogleAuth } = await import("google-auth-library");

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const oauthToken = process.env.GOOGLE_OAUTH_TOKEN;

  if (oauthToken) {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: oauthToken });
    return google.calendar({ version: "v3", auth: oauth2Client });
  }

  if (credentialsPath) {
    const auth = new GoogleAuth({
      keyFile: credentialsPath,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    const authClient = await auth.getClient();
    return google.calendar({ version: "v3", auth: authClient as any });
  }

  throw new Error(
    "No Google credentials configured. Set GOOGLE_OAUTH_TOKEN or GOOGLE_APPLICATION_CREDENTIALS."
  );
}

// ─── List Events ─────────────────────────────────────────────────────────

const ListEventsInputSchema = z.object({
  timeMin: z.string().describe("Start of time range (ISO 8601 datetime)"),
  timeMax: z.string().describe("End of time range (ISO 8601 datetime)"),
  calendarId: z
    .string()
    .optional()
    .default("primary")
    .describe("Calendar ID (default: primary)"),
  maxResults: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .default(25)
    .describe("Maximum number of events to return"),
});

export const calendarListEventsTool: ToolDefinitionRuntime = {
  name: "calendar_list_events",
  description:
    "List events from Google Calendar within a given time range. " +
    "Returns event summaries, times, and attendees.",
  parameters: {
    type: "object",
    properties: {
      timeMin: {
        type: "string",
        description: "Start of time range (ISO 8601 datetime)",
      },
      timeMax: {
        type: "string",
        description: "End of time range (ISO 8601 datetime)",
      },
      calendarId: {
        type: "string",
        description: "Calendar ID (default: primary)",
      },
      maxResults: {
        type: "integer",
        description: "Maximum number of events to return",
        minimum: 1,
        maximum: 100,
      },
    },
    required: ["timeMin", "timeMax"],
  },
  inputSchema: ListEventsInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 15_000,
  tags: ["calendar", "google", "read"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = ListEventsInputSchema.parse(input);
    const calendar = await getCalendarClient();

    logger.debug({ timeMin: parsed.timeMin, timeMax: parsed.timeMax }, "Listing calendar events");

    const response = await calendar.events.list({
      calendarId: parsed.calendarId,
      timeMin: parsed.timeMin,
      timeMax: parsed.timeMax,
      maxResults: parsed.maxResults,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = (response.data.items ?? []).map((event) => ({
      id: event.id,
      summary: event.summary,
      description: event.description,
      start: event.start?.dateTime ?? event.start?.date,
      end: event.end?.dateTime ?? event.end?.date,
      location: event.location,
      status: event.status,
      attendees: event.attendees?.map((a) => ({
        email: a.email,
        displayName: a.displayName,
        responseStatus: a.responseStatus,
      })),
      htmlLink: event.htmlLink,
    }));

    return { calendarId: parsed.calendarId, events, totalEvents: events.length };
  },
};

// ─── Get Event ───────────────────────────────────────────────────────────

const GetEventInputSchema = z.object({
  eventId: z.string().min(1).describe("The event ID to retrieve"),
  calendarId: z.string().optional().default("primary").describe("Calendar ID"),
});

export const calendarGetEventTool: ToolDefinitionRuntime = {
  name: "calendar_get_event",
  description: "Get details of a specific Google Calendar event by its ID.",
  parameters: {
    type: "object",
    properties: {
      eventId: { type: "string", description: "The event ID to retrieve" },
      calendarId: { type: "string", description: "Calendar ID (default: primary)" },
    },
    required: ["eventId"],
  },
  inputSchema: GetEventInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 10_000,
  tags: ["calendar", "google", "read"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = GetEventInputSchema.parse(input);
    const calendar = await getCalendarClient();

    logger.debug({ eventId: parsed.eventId }, "Getting calendar event");

    const response = await calendar.events.get({
      calendarId: parsed.calendarId,
      eventId: parsed.eventId,
    });

    const event = response.data;
    return {
      id: event.id,
      summary: event.summary,
      description: event.description,
      start: event.start?.dateTime ?? event.start?.date,
      end: event.end?.dateTime ?? event.end?.date,
      location: event.location,
      status: event.status,
      attendees: event.attendees?.map((a) => ({
        email: a.email,
        displayName: a.displayName,
        responseStatus: a.responseStatus,
      })),
      organizer: event.organizer,
      recurrence: event.recurrence,
      htmlLink: event.htmlLink,
    };
  },
};

// ─── Create Event ────────────────────────────────────────────────────────

const CreateEventInputSchema = z.object({
  summary: z.string().min(1).describe("Event title/summary"),
  start: z.string().describe("Start time (ISO 8601 datetime)"),
  end: z.string().describe("End time (ISO 8601 datetime)"),
  description: z.string().optional().describe("Event description"),
  attendees: z
    .array(z.string().email())
    .optional()
    .describe("List of attendee email addresses"),
  location: z.string().optional().describe("Event location"),
  calendarId: z.string().optional().default("primary").describe("Calendar ID"),
});

export const calendarCreateEventTool: ToolDefinitionRuntime = {
  name: "calendar_create_event",
  description:
    "Create a new event on Google Calendar with summary, start/end times, " +
    "optional description, attendees, and location.",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Event title/summary" },
      start: { type: "string", description: "Start time (ISO 8601 datetime)" },
      end: { type: "string", description: "End time (ISO 8601 datetime)" },
      description: { type: "string", description: "Event description" },
      attendees: {
        type: "array",
        items: { type: "string" },
        description: "List of attendee email addresses",
      },
      location: { type: "string", description: "Event location" },
      calendarId: { type: "string", description: "Calendar ID (default: primary)" },
    },
    required: ["summary", "start", "end"],
  },
  inputSchema: CreateEventInputSchema,
  riskLevel: "medium",
  requiresApproval: false,
  timeout: 15_000,
  tags: ["calendar", "google", "write"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = CreateEventInputSchema.parse(input);
    const calendar = await getCalendarClient();

    logger.info({ summary: parsed.summary }, "Creating calendar event");

    const eventBody: Record<string, unknown> = {
      summary: parsed.summary,
      start: { dateTime: parsed.start },
      end: { dateTime: parsed.end },
    };

    if (parsed.description) eventBody.description = parsed.description;
    if (parsed.location) eventBody.location = parsed.location;
    if (parsed.attendees) {
      eventBody.attendees = parsed.attendees.map((email) => ({ email }));
    }

    const response = await calendar.events.insert({
      calendarId: parsed.calendarId,
      requestBody: eventBody as any,
    });

    return {
      id: response.data.id,
      summary: response.data.summary,
      htmlLink: response.data.htmlLink,
      status: response.data.status,
    };
  },
};

// ─── Update Event ────────────────────────────────────────────────────────

const UpdateEventInputSchema = z.object({
  eventId: z.string().min(1).describe("The event ID to update"),
  summary: z.string().optional().describe("Updated event title"),
  start: z.string().optional().describe("Updated start time (ISO 8601)"),
  end: z.string().optional().describe("Updated end time (ISO 8601)"),
  description: z.string().optional().describe("Updated description"),
  attendees: z
    .array(z.string().email())
    .optional()
    .describe("Updated attendee list (replaces existing)"),
  location: z.string().optional().describe("Updated location"),
  calendarId: z.string().optional().default("primary").describe("Calendar ID"),
});

export const calendarUpdateEventTool: ToolDefinitionRuntime = {
  name: "calendar_update_event",
  description:
    "Update an existing Google Calendar event. Only provided fields are updated.",
  parameters: {
    type: "object",
    properties: {
      eventId: { type: "string", description: "The event ID to update" },
      summary: { type: "string", description: "Updated event title" },
      start: { type: "string", description: "Updated start time (ISO 8601)" },
      end: { type: "string", description: "Updated end time (ISO 8601)" },
      description: { type: "string", description: "Updated description" },
      attendees: {
        type: "array",
        items: { type: "string" },
        description: "Updated attendee list",
      },
      location: { type: "string", description: "Updated location" },
      calendarId: { type: "string", description: "Calendar ID (default: primary)" },
    },
    required: ["eventId"],
  },
  inputSchema: UpdateEventInputSchema,
  riskLevel: "medium",
  requiresApproval: false,
  timeout: 15_000,
  tags: ["calendar", "google", "write"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = UpdateEventInputSchema.parse(input);
    const calendar = await getCalendarClient();

    logger.info({ eventId: parsed.eventId }, "Updating calendar event");

    const patch: Record<string, unknown> = {};
    if (parsed.summary) patch.summary = parsed.summary;
    if (parsed.description !== undefined) patch.description = parsed.description;
    if (parsed.location !== undefined) patch.location = parsed.location;
    if (parsed.start) patch.start = { dateTime: parsed.start };
    if (parsed.end) patch.end = { dateTime: parsed.end };
    if (parsed.attendees) {
      patch.attendees = parsed.attendees.map((email) => ({ email }));
    }

    const response = await calendar.events.patch({
      calendarId: parsed.calendarId,
      eventId: parsed.eventId,
      requestBody: patch as any,
    });

    return {
      id: response.data.id,
      summary: response.data.summary,
      htmlLink: response.data.htmlLink,
      updated: response.data.updated,
    };
  },
};

// ─── Delete Event ────────────────────────────────────────────────────────

const DeleteEventInputSchema = z.object({
  eventId: z.string().min(1).describe("The event ID to delete"),
  calendarId: z.string().optional().default("primary").describe("Calendar ID"),
});

export const calendarDeleteEventTool: ToolDefinitionRuntime = {
  name: "calendar_delete_event",
  description: "Delete a Google Calendar event by its ID.",
  parameters: {
    type: "object",
    properties: {
      eventId: { type: "string", description: "The event ID to delete" },
      calendarId: { type: "string", description: "Calendar ID (default: primary)" },
    },
    required: ["eventId"],
  },
  inputSchema: DeleteEventInputSchema,
  riskLevel: "medium",
  requiresApproval: true,
  timeout: 10_000,
  tags: ["calendar", "google", "write", "delete"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = DeleteEventInputSchema.parse(input);
    const calendar = await getCalendarClient();

    logger.info({ eventId: parsed.eventId }, "Deleting calendar event");

    await calendar.events.delete({
      calendarId: parsed.calendarId,
      eventId: parsed.eventId,
    });

    return { deleted: true, eventId: parsed.eventId };
  },
};

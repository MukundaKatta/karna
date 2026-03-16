// ─── Gmail Email Tool ──────────────────────────────────────────────────────

import { z } from "zod";
import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../registry.js";

const logger = pino({ name: "tool-email" });

// ─── Auth Helper ─────────────────────────────────────────────────────────

async function getGmailClient() {
  const { google } = await import("googleapis");
  const { GoogleAuth } = await import("google-auth-library");

  const oauthToken = process.env.GOOGLE_OAUTH_TOKEN;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (oauthToken) {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: oauthToken });
    return google.gmail({ version: "v1", auth: oauth2Client });
  }

  if (credentialsPath) {
    const auth = new GoogleAuth({
      keyFile: credentialsPath,
      scopes: ["https://www.googleapis.com/auth/gmail.modify"],
    });
    const authClient = await auth.getClient();
    return google.gmail({ version: "v1", auth: authClient as any });
  }

  throw new Error(
    "No Google credentials configured. Set GOOGLE_OAUTH_TOKEN or GOOGLE_APPLICATION_CREDENTIALS."
  );
}

// ─── MIME Helpers ────────────────────────────────────────────────────────

function buildMimeMessage(opts: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}): string {
  const lines: string[] = [
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
  ];
  if (opts.cc) lines.push(`Cc: ${opts.cc}`);
  if (opts.bcc) lines.push(`Bcc: ${opts.bcc}`);
  lines.push("", opts.body);

  const raw = lines.join("\r\n");
  return Buffer.from(raw).toString("base64url");
}

function decodeBody(data: string | null | undefined): string {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf-8");
}

function extractBody(payload: any): string {
  if (payload.body?.data) {
    return decodeBody(payload.body.data);
  }

  if (payload.parts) {
    // Prefer text/plain, fall back to text/html
    const textPart = payload.parts.find(
      (p: any) => p.mimeType === "text/plain"
    );
    if (textPart?.body?.data) {
      return decodeBody(textPart.body.data);
    }

    const htmlPart = payload.parts.find(
      (p: any) => p.mimeType === "text/html"
    );
    if (htmlPart?.body?.data) {
      return decodeBody(htmlPart.body.data);
    }

    // Recurse into nested parts
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }

  return "";
}

function getHeader(headers: any[], name: string): string {
  const header = headers?.find(
    (h: any) => h.name.toLowerCase() === name.toLowerCase()
  );
  return header?.value ?? "";
}

// ─── List Emails ─────────────────────────────────────────────────────────

const ListEmailsInputSchema = z.object({
  query: z
    .string()
    .optional()
    .default("")
    .describe("Gmail search query (e.g. 'from:alice is:unread')"),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(10)
    .describe("Maximum number of emails to return"),
});

export const emailListTool: ToolDefinitionRuntime = {
  name: "email_list",
  description:
    "List emails from Gmail matching an optional search query. " +
    "Returns message IDs, subjects, from, date, and snippet.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Gmail search query (e.g. 'from:alice is:unread')",
      },
      maxResults: {
        type: "integer",
        description: "Maximum number of emails to return",
        minimum: 1,
        maximum: 50,
      },
    },
  },
  inputSchema: ListEmailsInputSchema,
  riskLevel: "medium",
  requiresApproval: false,
  timeout: 15_000,
  tags: ["email", "gmail", "read"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = ListEmailsInputSchema.parse(input);
    const gmail = await getGmailClient();

    logger.debug({ query: parsed.query, maxResults: parsed.maxResults }, "Listing emails");

    const listResponse = await gmail.users.messages.list({
      userId: "me",
      q: parsed.query || undefined,
      maxResults: parsed.maxResults,
    });

    const messageIds = listResponse.data.messages ?? [];
    if (messageIds.length === 0) {
      return { emails: [], totalResults: 0, query: parsed.query };
    }

    const emails = await Promise.all(
      messageIds.map(async (msg) => {
        const detail = await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "Date", "To"],
        });

        const headers = detail.data.payload?.headers ?? [];
        return {
          id: detail.data.id,
          threadId: detail.data.threadId,
          subject: getHeader(headers, "Subject"),
          from: getHeader(headers, "From"),
          to: getHeader(headers, "To"),
          date: getHeader(headers, "Date"),
          snippet: detail.data.snippet,
          labelIds: detail.data.labelIds,
        };
      })
    );

    return { emails, totalResults: emails.length, query: parsed.query };
  },
};

// ─── Read Email ──────────────────────────────────────────────────────────

const ReadEmailInputSchema = z.object({
  messageId: z.string().min(1).describe("The Gmail message ID to read"),
});

export const emailReadTool: ToolDefinitionRuntime = {
  name: "email_read",
  description: "Read the full content of a specific Gmail message by its ID.",
  parameters: {
    type: "object",
    properties: {
      messageId: { type: "string", description: "The Gmail message ID to read" },
    },
    required: ["messageId"],
  },
  inputSchema: ReadEmailInputSchema,
  riskLevel: "medium",
  requiresApproval: false,
  timeout: 10_000,
  tags: ["email", "gmail", "read"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = ReadEmailInputSchema.parse(input);
    const gmail = await getGmailClient();

    logger.debug({ messageId: parsed.messageId }, "Reading email");

    const response = await gmail.users.messages.get({
      userId: "me",
      id: parsed.messageId,
      format: "full",
    });

    const headers = response.data.payload?.headers ?? [];
    const body = extractBody(response.data.payload);

    return {
      id: response.data.id,
      threadId: response.data.threadId,
      subject: getHeader(headers, "Subject"),
      from: getHeader(headers, "From"),
      to: getHeader(headers, "To"),
      cc: getHeader(headers, "Cc"),
      date: getHeader(headers, "Date"),
      body,
      labelIds: response.data.labelIds,
      snippet: response.data.snippet,
    };
  },
};

// ─── Send Email ──────────────────────────────────────────────────────────

const SendEmailInputSchema = z.object({
  to: z.string().min(1).describe("Recipient email address(es), comma-separated"),
  subject: z.string().min(1).describe("Email subject line"),
  body: z.string().min(1).describe("Email body (plain text)"),
  cc: z.string().optional().describe("CC recipients, comma-separated"),
  bcc: z.string().optional().describe("BCC recipients, comma-separated"),
});

export const emailSendTool: ToolDefinitionRuntime = {
  name: "email_send",
  description:
    "Send an email via Gmail. Composes a plain-text MIME message " +
    "and sends it. Supports CC and BCC recipients.",
  parameters: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address(es), comma-separated" },
      subject: { type: "string", description: "Email subject line" },
      body: { type: "string", description: "Email body (plain text)" },
      cc: { type: "string", description: "CC recipients, comma-separated" },
      bcc: { type: "string", description: "BCC recipients, comma-separated" },
    },
    required: ["to", "subject", "body"],
  },
  inputSchema: SendEmailInputSchema,
  riskLevel: "high",
  requiresApproval: true,
  timeout: 15_000,
  tags: ["email", "gmail", "write", "send"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = SendEmailInputSchema.parse(input);
    const gmail = await getGmailClient();

    logger.info({ to: parsed.to, subject: parsed.subject }, "Sending email");

    const raw = buildMimeMessage({
      to: parsed.to,
      subject: parsed.subject,
      body: parsed.body,
      cc: parsed.cc,
      bcc: parsed.bcc,
    });

    const response = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    return {
      id: response.data.id,
      threadId: response.data.threadId,
      labelIds: response.data.labelIds,
      sent: true,
    };
  },
};

// ─── Create Draft ────────────────────────────────────────────────────────

const CreateDraftInputSchema = z.object({
  to: z.string().min(1).describe("Recipient email address(es)"),
  subject: z.string().min(1).describe("Email subject line"),
  body: z.string().min(1).describe("Email body (plain text)"),
});

export const emailCreateDraftTool: ToolDefinitionRuntime = {
  name: "email_create_draft",
  description: "Create a draft email in Gmail without sending it.",
  parameters: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address(es)" },
      subject: { type: "string", description: "Email subject line" },
      body: { type: "string", description: "Email body (plain text)" },
    },
    required: ["to", "subject", "body"],
  },
  inputSchema: CreateDraftInputSchema,
  riskLevel: "medium",
  requiresApproval: false,
  timeout: 10_000,
  tags: ["email", "gmail", "write", "draft"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = CreateDraftInputSchema.parse(input);
    const gmail = await getGmailClient();

    logger.info({ to: parsed.to, subject: parsed.subject }, "Creating email draft");

    const raw = buildMimeMessage({
      to: parsed.to,
      subject: parsed.subject,
      body: parsed.body,
    });

    const response = await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: { raw },
      },
    });

    return {
      draftId: response.data.id,
      messageId: response.data.message?.id,
      created: true,
    };
  },
};

// ─── Search Emails ───────────────────────────────────────────────────────

const SearchEmailsInputSchema = z.object({
  query: z.string().min(1).describe("Gmail search query"),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(10)
    .describe("Maximum number of results"),
});

export const emailSearchTool: ToolDefinitionRuntime = {
  name: "email_search",
  description:
    "Search Gmail using a query string. Supports Gmail search operators " +
    "like 'from:', 'to:', 'subject:', 'is:unread', 'has:attachment', date ranges, etc.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Gmail search query" },
      maxResults: {
        type: "integer",
        description: "Maximum number of results",
        minimum: 1,
        maximum: 50,
      },
    },
    required: ["query"],
  },
  inputSchema: SearchEmailsInputSchema,
  riskLevel: "medium",
  requiresApproval: false,
  timeout: 15_000,
  tags: ["email", "gmail", "search"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = SearchEmailsInputSchema.parse(input);
    const gmail = await getGmailClient();

    logger.debug({ query: parsed.query }, "Searching emails");

    const listResponse = await gmail.users.messages.list({
      userId: "me",
      q: parsed.query,
      maxResults: parsed.maxResults,
    });

    const messageIds = listResponse.data.messages ?? [];
    if (messageIds.length === 0) {
      return { results: [], totalResults: 0, query: parsed.query };
    }

    const results = await Promise.all(
      messageIds.map(async (msg) => {
        const detail = await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "Date", "To"],
        });

        const headers = detail.data.payload?.headers ?? [];
        return {
          id: detail.data.id,
          threadId: detail.data.threadId,
          subject: getHeader(headers, "Subject"),
          from: getHeader(headers, "From"),
          to: getHeader(headers, "To"),
          date: getHeader(headers, "Date"),
          snippet: detail.data.snippet,
          labelIds: detail.data.labelIds,
        };
      })
    );

    return { results, totalResults: results.length, query: parsed.query };
  },
};

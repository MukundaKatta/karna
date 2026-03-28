// ─── Google Workspace Integration Tools ───────────────────────────────────
//
// Adds Drive search/download and Contacts search on top of the existing
// calendar and email tools. Uses the `googleapis` library already in deps.

import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../../registry.js";

const logger = pino({ name: "tool-google" });
const TIMEOUT_MS = 20_000;

// ─── Auth Helpers ─────────────────────────────────────────────────────────

async function getGoogleAuth(scopes: string[]) {
  const { google } = await import("googleapis");
  const { GoogleAuth } = await import("google-auth-library");

  const oauthToken = process.env.GOOGLE_OAUTH_TOKEN;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (oauthToken) {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: oauthToken });
    return oauth2Client;
  }

  if (credentialsPath) {
    const auth = new GoogleAuth({ keyFile: credentialsPath, scopes });
    return (await auth.getClient()) as any;
  }

  throw new Error(
    "No Google credentials configured. Set GOOGLE_OAUTH_TOKEN or GOOGLE_APPLICATION_CREDENTIALS."
  );
}

function wrapTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// ─── google_drive_search ──────────────────────────────────────────────────

const DriveSearchSchema = z.object({
  query: z.string().min(1).describe("Search query (file name or content keywords)"),
  mimeType: z
    .string()
    .optional()
    .describe("Filter by MIME type (e.g. application/pdf, application/vnd.google-apps.document)"),
  maxResults: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
  trashed: z.boolean().optional().describe("Include trashed files (default false)"),
});

export const googleDriveSearchTool: ToolDefinitionRuntime = {
  name: "google_drive_search",
  description:
    "Search Google Drive for files by name or content. " +
    "Returns file ID, name, MIME type, modified time, and web link.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      mimeType: { type: "string", description: "Filter by MIME type" },
      maxResults: { type: "integer", description: "Max results (default 10)", maximum: 50 },
      trashed: { type: "boolean", description: "Include trashed files" },
    },
    required: ["query"],
  },
  inputSchema: DriveSearchSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: TIMEOUT_MS,
  tags: ["integration", "google", "drive"],

  async execute(input) {
    const p = DriveSearchSchema.parse(input);
    try {
      const auth = await getGoogleAuth(["https://www.googleapis.com/auth/drive.readonly"]);
      const { google } = await import("googleapis");
      const drive = google.drive({ version: "v3", auth });

      let q = `fullText contains '${p.query.replace(/'/g, "\\'")}'`;
      if (p.mimeType) q += ` and mimeType = '${p.mimeType}'`;
      if (!p.trashed) q += " and trashed = false";

      const res = await wrapTimeout(
        drive.files.list({
          q,
          pageSize: p.maxResults ?? 10,
          fields: "files(id,name,mimeType,modifiedTime,webViewLink,size,owners)",
          orderBy: "modifiedTime desc",
        }),
        TIMEOUT_MS,
        "Drive search"
      );

      const files = res.data.files ?? [];
      if (files.length === 0) {
        return { output: `No files found matching "${p.query}".`, isError: false };
      }
      return { output: JSON.stringify(files, null, 2), isError: false };
    } catch (err: any) {
      logger.error({ err }, "Drive search failed");
      return { output: `Drive search failed: ${err.message}`, isError: true };
    }
  },
};

// ─── google_drive_download ────────────────────────────────────────────────

const DriveDownloadSchema = z.object({
  fileId: z.string().min(1).describe("Google Drive file ID"),
  filename: z.string().optional().describe("Local filename to save as (default: original name)"),
  outputDir: z.string().optional().describe("Directory to save to (default: system temp dir)"),
});

export const googleDriveDownloadTool: ToolDefinitionRuntime = {
  name: "google_drive_download",
  description:
    "Download a file from Google Drive by its file ID. " +
    "For Google Docs/Sheets/Slides, exports as PDF. Returns the local file path.",
  parameters: {
    type: "object",
    properties: {
      fileId: { type: "string", description: "Google Drive file ID" },
      filename: { type: "string", description: "Local filename" },
      outputDir: { type: "string", description: "Output directory" },
    },
    required: ["fileId"],
  },
  inputSchema: DriveDownloadSchema,
  riskLevel: "medium",
  requiresApproval: true,
  timeout: 30_000,
  tags: ["integration", "google", "drive"],

  async execute(input) {
    const p = DriveDownloadSchema.parse(input);
    try {
      const auth = await getGoogleAuth(["https://www.googleapis.com/auth/drive.readonly"]);
      const { google } = await import("googleapis");
      const drive = google.drive({ version: "v3", auth });

      // Get file metadata
      const meta = await drive.files.get({ fileId: p.fileId, fields: "name,mimeType" });
      const name = p.filename ?? meta.data.name ?? "download";
      const mime = meta.data.mimeType ?? "";

      const outputDir = p.outputDir ?? join(tmpdir(), "karna-drive");
      await mkdir(outputDir, { recursive: true });

      const isGoogleDoc = mime.startsWith("application/vnd.google-apps.");
      let destPath: string;
      let data: Buffer;

      if (isGoogleDoc) {
        // Export Google Workspace files as PDF
        const exportMime = "application/pdf";
        const res = await wrapTimeout(
          drive.files.export({ fileId: p.fileId, mimeType: exportMime }, { responseType: "arraybuffer" }),
          30_000,
          "Drive export"
        );
        data = Buffer.from(res.data as ArrayBuffer);
        destPath = join(outputDir, name.replace(/\.[^.]*$/, "") + ".pdf");
      } else {
        const res = await wrapTimeout(
          drive.files.get({ fileId: p.fileId, alt: "media" }, { responseType: "arraybuffer" }),
          30_000,
          "Drive download"
        );
        data = Buffer.from(res.data as ArrayBuffer);
        destPath = join(outputDir, name);
      }

      await writeFile(destPath, data);
      return {
        output: JSON.stringify({ path: destPath, size: data.length, mimeType: mime }),
        isError: false,
      };
    } catch (err: any) {
      logger.error({ err }, "Drive download failed");
      return { output: `Drive download failed: ${err.message}`, isError: true };
    }
  },
};

// ─── google_contacts_search ───────────────────────────────────────────────

const ContactsSearchSchema = z.object({
  query: z.string().min(1).describe("Name or email to search for"),
  maxResults: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
});

export const googleContactsSearchTool: ToolDefinitionRuntime = {
  name: "google_contacts_search",
  description:
    "Search Google Contacts by name or email. Returns names, emails, phone numbers, and organizations.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Name or email to search" },
      maxResults: { type: "integer", description: "Max results (default 10)", maximum: 50 },
    },
    required: ["query"],
  },
  inputSchema: ContactsSearchSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: TIMEOUT_MS,
  tags: ["integration", "google", "contacts"],

  async execute(input) {
    const p = ContactsSearchSchema.parse(input);
    try {
      const auth = await getGoogleAuth([
        "https://www.googleapis.com/auth/contacts.readonly",
      ]);
      const { google } = await import("googleapis");
      const people = google.people({ version: "v1", auth });

      const res = await wrapTimeout(
        people.people.searchContacts({
          query: p.query,
          pageSize: p.maxResults ?? 10,
          readMask: "names,emailAddresses,phoneNumbers,organizations,photos",
        }),
        TIMEOUT_MS,
        "Contacts search"
      );

      const results = (res.data.results ?? []).map((r: any) => {
        const person = r.person ?? {};
        return {
          name: person.names?.[0]?.displayName ?? null,
          emails: (person.emailAddresses ?? []).map((e: any) => e.value),
          phones: (person.phoneNumbers ?? []).map((p: any) => p.value),
          org: person.organizations?.[0]?.name ?? null,
        };
      });

      if (results.length === 0) {
        return { output: `No contacts found matching "${p.query}".`, isError: false };
      }
      return { output: JSON.stringify(results, null, 2), isError: false };
    } catch (err: any) {
      logger.error({ err }, "Contacts search failed");
      return { output: `Contacts search failed: ${err.message}`, isError: true };
    }
  },
};

// ─── Collected exports ────────────────────────────────────────────────────

export const googleTools: ToolDefinitionRuntime[] = [
  googleDriveSearchTool,
  googleDriveDownloadTool,
  googleContactsSearchTool,
];

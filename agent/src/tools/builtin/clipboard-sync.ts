import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { ClipboardSyncMessage } from "@karna/shared/types/protocol.js";
import type { ToolDefinitionRuntime } from "../registry.js";

const HISTORY_LIMIT = 10;
const DEFAULT_TIMEOUT_MS = 10_000;
const clipboardHistory: ClipboardHistoryItem[] = [];
const execFileAsync = promisify(execFile);

interface ClipboardHistoryItem {
  itemId: string;
  sourceDeviceId: string;
  targetDeviceId?: string;
  contentPreview: string;
  encryptedContent: string;
  createdAt: number;
}

const ClipboardSyncSendInputSchema = z.object({
  content: z.string().optional().describe("Text to sync. If omitted and readFromMacClipboard is true, reads pbpaste."),
  readFromMacClipboard: z.boolean().optional().default(false),
  sourceDeviceId: z.string().min(1).default("macos-host"),
  targetDeviceId: z.string().min(1).optional(),
  encryptionKey: z.string().optional().describe("Shared secret. Defaults to KARNA_CLIPBOARD_SYNC_KEY."),
});

const ClipboardSyncApplyInputSchema = z.object({
  message: z.unknown().describe("clipboard.sync protocol message"),
  encryptionKey: z.string().optional().describe("Shared secret. Defaults to KARNA_CLIPBOARD_SYNC_KEY."),
  writeToMacClipboard: z.boolean().optional().default(false),
});

const ClipboardHistoryInputSchema = z.object({});

export const clipboardSyncSendTool: ToolDefinitionRuntime = {
  name: "clipboard_sync_send",
  description:
    "Encrypt text or the current macOS clipboard into a clipboard.sync protocol message for another connected Karna device.",
  parameters: {
    type: "object",
    properties: {
      content: { type: "string", description: "Text content to sync" },
      readFromMacClipboard: { type: "boolean", description: "Read current macOS clipboard with pbpaste" },
      sourceDeviceId: { type: "string", description: "Source device id" },
      targetDeviceId: { type: "string", description: "Optional target device id" },
      encryptionKey: { type: "string", description: "Shared secret override" },
    },
  },
  inputSchema: ClipboardSyncSendInputSchema,
  riskLevel: "high",
  requiresApproval: true,
  timeout: DEFAULT_TIMEOUT_MS,
  tags: ["clipboard", "sync", "encryption"],
  async execute(input) {
    const parsed = ClipboardSyncSendInputSchema.parse(input);
    const content = parsed.readFromMacClipboard ? await readMacClipboard() : parsed.content;
    if (!content) {
      throw new Error("clipboard_sync_send requires content or readFromMacClipboard=true");
    }

    const key = resolveClipboardKey(parsed.encryptionKey);
    const encrypted = encryptClipboardContent(content, key);
    const createdAt = Date.now();
    const itemId = randomUUID();
    const message: ClipboardSyncMessage = {
      id: `clipboard-${itemId}`,
      type: "clipboard.sync",
      timestamp: createdAt,
      payload: {
        itemId,
        sourceDeviceId: parsed.sourceDeviceId,
        targetDeviceId: parsed.targetDeviceId,
        encryptedContent: encrypted.encryptedContent,
        encryption: {
          algorithm: "aes-256-gcm",
          iv: encrypted.iv,
          authTag: encrypted.authTag,
        },
        contentType: "text/plain",
        createdAt,
      },
    };

    rememberClipboardItem({
      itemId,
      sourceDeviceId: parsed.sourceDeviceId,
      targetDeviceId: parsed.targetDeviceId,
      contentPreview: previewContent(content),
      encryptedContent: encrypted.encryptedContent,
      createdAt,
    });

    return { message, historyCount: clipboardHistory.length };
  },
};

export const clipboardSyncApplyTool: ToolDefinitionRuntime = {
  name: "clipboard_sync_apply",
  description:
    "Decrypt a clipboard.sync protocol message and optionally write the plaintext to the macOS clipboard.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "object", description: "clipboard.sync protocol message" },
      encryptionKey: { type: "string", description: "Shared secret override" },
      writeToMacClipboard: { type: "boolean", description: "Write decrypted content with pbcopy" },
    },
    required: ["message"],
  },
  inputSchema: ClipboardSyncApplyInputSchema,
  riskLevel: "high",
  requiresApproval: true,
  timeout: DEFAULT_TIMEOUT_MS,
  tags: ["clipboard", "sync", "encryption"],
  async execute(input) {
    const parsed = ClipboardSyncApplyInputSchema.parse(input);
    const message = parseClipboardSyncMessage(parsed.message);
    const content = decryptClipboardContent(
      {
        encryptedContent: message.payload.encryptedContent,
        iv: message.payload.encryption.iv,
        authTag: message.payload.encryption.authTag,
      },
      resolveClipboardKey(parsed.encryptionKey),
    );

    if (parsed.writeToMacClipboard) {
      await writeMacClipboard(content);
    }

    rememberClipboardItem({
      itemId: message.payload.itemId,
      sourceDeviceId: message.payload.sourceDeviceId,
      targetDeviceId: message.payload.targetDeviceId,
      contentPreview: previewContent(content),
      encryptedContent: message.payload.encryptedContent,
      createdAt: message.payload.createdAt,
    });

    return {
      itemId: message.payload.itemId,
      sourceDeviceId: message.payload.sourceDeviceId,
      targetDeviceId: message.payload.targetDeviceId,
      content,
      wroteToMacClipboard: parsed.writeToMacClipboard,
      historyCount: clipboardHistory.length,
    };
  },
};

export const clipboardSyncHistoryTool: ToolDefinitionRuntime = {
  name: "clipboard_sync_history",
  description: "List metadata for the last 10 clipboard sync items without exposing full plaintext content.",
  parameters: {
    type: "object",
    properties: {},
  },
  inputSchema: ClipboardHistoryInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: DEFAULT_TIMEOUT_MS,
  tags: ["clipboard", "sync", "history"],
  async execute() {
    ClipboardHistoryInputSchema.parse({});
    return { items: getClipboardHistory() };
  },
};

export function encryptClipboardContent(content: string, keyMaterial: string) {
  const key = deriveKey(keyMaterial);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(content, "utf8"), cipher.final()]);
  return {
    encryptedContent: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptClipboardContent(
  encrypted: { encryptedContent: string; iv: string; authTag: string },
  keyMaterial: string,
): string {
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(keyMaterial), Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.encryptedContent, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function rememberClipboardItem(item: ClipboardHistoryItem): void {
  clipboardHistory.unshift(item);
  clipboardHistory.splice(HISTORY_LIMIT);
}

export function getClipboardHistory(): ClipboardHistoryItem[] {
  return clipboardHistory.map((item) => ({ ...item }));
}

function parseClipboardSyncMessage(value: unknown): ClipboardSyncMessage {
  const parsed = z
    .object({
      id: z.string().min(1),
      type: z.literal("clipboard.sync"),
      timestamp: z.number().int().positive(),
      sessionId: z.string().min(1).optional(),
      payload: z.object({
        itemId: z.string().min(1),
        sourceDeviceId: z.string().min(1),
        targetDeviceId: z.string().min(1).optional(),
        encryptedContent: z.string().min(1),
        encryption: z.object({
          algorithm: z.literal("aes-256-gcm"),
          iv: z.string().min(1),
          authTag: z.string().min(1),
        }),
        contentType: z.literal("text/plain"),
        createdAt: z.number().int().positive(),
      }),
    })
    .parse(value);
  return parsed;
}

function resolveClipboardKey(override: string | undefined): string {
  const key = override ?? process.env["KARNA_CLIPBOARD_SYNC_KEY"];
  if (!key) {
    throw new Error("Clipboard sync requires KARNA_CLIPBOARD_SYNC_KEY or encryptionKey");
  }
  return key;
}

function deriveKey(keyMaterial: string): Buffer {
  return createHash("sha256").update(keyMaterial).digest();
}

function previewContent(content: string): string {
  return content.length <= 80 ? content : `${content.slice(0, 77)}...`;
}

async function readMacClipboard(): Promise<string> {
  assertMacOS();
  const { stdout } = await execFileAsync("pbpaste", [], { timeout: DEFAULT_TIMEOUT_MS, maxBuffer: 1_000_000 });
  return stdout;
}

function writeMacClipboard(content: string): Promise<void> {
  assertMacOS();
  return new Promise((resolve, reject) => {
    const child = spawn("pbcopy", [], { timeout: DEFAULT_TIMEOUT_MS });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pbcopy exited with code ${code}`));
    });
    child.stdin.end(content);
  });
}

function assertMacOS(): void {
  if (process.platform !== "darwin") {
    throw new Error("macOS clipboard access is only available on macOS");
  }
}

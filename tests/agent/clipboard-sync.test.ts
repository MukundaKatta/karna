import { describe, expect, it } from "vitest";
import { safeParseProtocolMessage } from "../../packages/shared/src/types/protocol.js";
import {
  clipboardSyncApplyTool,
  clipboardSyncHistoryTool,
  clipboardSyncSendTool,
  decryptClipboardContent,
  encryptClipboardContent,
  getClipboardHistory,
  rememberClipboardItem,
} from "../../agent/src/tools/builtin/clipboard-sync.js";
import { allBuiltinTools } from "../../agent/src/tools/builtin/index.js";

const context = { sessionId: "session-1", agentId: "agent-1" };

describe("clipboard sync", () => {
  it("adds clipboard sync to the protocol schema", () => {
    const now = Date.now();
    const parsed = safeParseProtocolMessage({
      id: "clip-1",
      type: "clipboard.sync",
      timestamp: now,
      payload: {
        itemId: "item-1",
        sourceDeviceId: "macbook",
        targetDeviceId: "iphone",
        encryptedContent: "ZmFrZQ==",
        encryption: {
          algorithm: "aes-256-gcm",
          iv: "aXY=",
          authTag: "dGFn",
        },
        contentType: "text/plain",
        createdAt: now,
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("encrypts and decrypts clipboard content with AES-256-GCM", () => {
    const encrypted = encryptClipboardContent("copy this", "secret-key");
    expect(encrypted.encryptedContent).not.toBe(Buffer.from("copy this").toString("base64"));
    expect(decryptClipboardContent(encrypted, "secret-key")).toBe("copy this");
  });

  it("creates encrypted clipboard.sync messages and applies them", async () => {
    const sendResult = (await clipboardSyncSendTool.execute(
      {
        content: "hello phone",
        sourceDeviceId: "macbook",
        targetDeviceId: "iphone",
        encryptionKey: "secret-key",
      },
      context,
    )) as { message: unknown };

    const parsed = safeParseProtocolMessage(sendResult.message);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("Expected clipboard sync message");
    expect(parsed.data.type).toBe("clipboard.sync");
    expect(parsed.data.payload.encryptedContent).not.toContain("hello phone");

    await expect(
      clipboardSyncApplyTool.execute(
        {
          message: sendResult.message,
          encryptionKey: "secret-key",
          writeToMacClipboard: false,
        },
        context,
      ),
    ).resolves.toMatchObject({
      content: "hello phone",
      wroteToMacClipboard: false,
    });
  });

  it("keeps only the last 10 clipboard history items", () => {
    for (let index = 0; index < 12; index += 1) {
      rememberClipboardItem({
        itemId: `item-${index}`,
        sourceDeviceId: "test",
        contentPreview: `content-${index}`,
        encryptedContent: "encrypted",
        createdAt: index + 1,
      });
    }

    const history = getClipboardHistory();
    expect(history).toHaveLength(10);
    expect(history[0]?.itemId).toBe("item-11");
    expect(history[9]?.itemId).toBe("item-2");
  });

  it("registers clipboard sync tools as built-ins", async () => {
    const names = allBuiltinTools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      "clipboard_sync_send",
      "clipboard_sync_apply",
      "clipboard_sync_history",
    ]));
    await expect(clipboardSyncHistoryTool.execute({}, context)).resolves.toHaveProperty("items");
  });
});

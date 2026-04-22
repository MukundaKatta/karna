import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { PersistentSessionMap } from "../../packages/shared/src/utils/persistent-session-map.js";

describe("PersistentSessionMap", () => {
  it("persists and restores string-keyed session data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "karna-session-map-"));
    const storagePath = join(dir, "slack.json");

    try {
      const store = new PersistentSessionMap<string, { sessionId: string }>({
        name: "slack",
        storagePath,
      });

      store.set("channel-1", { sessionId: "session-1" });
      await store.flush();

      const restored = new PersistentSessionMap<string, { sessionId: string }>({
        name: "slack",
        storagePath,
      });
      await restored.load();

      expect(restored.get("channel-1")).toEqual({ sessionId: "session-1" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("supports numeric keys for channels like Telegram", async () => {
    const dir = await mkdtemp(join(tmpdir(), "karna-session-map-"));
    const storagePath = join(dir, "telegram.json");

    try {
      const store = new PersistentSessionMap<number, string>({
        name: "telegram",
        storagePath,
        serializeKey: (chatId) => String(chatId),
        deserializeKey: (chatId) => Number(chatId),
      });

      store.set(123456789, "session-1");
      await store.flush();

      const restored = new PersistentSessionMap<number, string>({
        name: "telegram",
        storagePath,
        serializeKey: (chatId) => String(chatId),
        deserializeKey: (chatId) => Number(chatId),
      });
      await restored.load();

      expect(restored.get(123456789)).toBe("session-1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("removes persisted files when the session map becomes empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "karna-session-map-"));
    const storagePath = join(dir, "signal.json");

    try {
      const store = new PersistentSessionMap<string, string>({
        name: "signal",
        storagePath,
      });

      store.set("+15551234567", "session-1");
      await store.flush();
      expect(existsSync(storagePath)).toBe(true);

      store.delete("+15551234567");
      await store.flush();

      expect(existsSync(storagePath)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ignores malformed persisted payloads without throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "karna-session-map-"));
    const storagePath = join(dir, "broken.json");

    try {
      await writeFile(storagePath, '{"version":1,"entries":[{"key":42}]}', "utf-8");

      const store = new PersistentSessionMap<string, string>({
        name: "broken",
        storagePath,
      });

      await store.load();

      expect(store.size).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

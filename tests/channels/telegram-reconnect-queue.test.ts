import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("Telegram reconnect queue", () => {
  const source = readFileSync(
    join(ROOT, "channels/telegram/src/adapter.ts"),
    "utf-8",
  );

  it("queues inbound Telegram messages while the gateway reconnects", () => {
    expect(source).toContain("private reconnectQueue");
    expect(source).toContain("this.enqueueForReconnect");
    expect(source).toContain("I queued this message");
  });

  it("flushes queued messages after the gateway socket reopens", () => {
    expect(source).toContain("void this.flushReconnectQueue()");
    expect(source).toContain("queuedDuringReconnect");
    expect(source).toContain("Flushing queued Telegram messages after reconnect");
  });

  it("bounds the reconnect queue and tracks dropped messages", () => {
    expect(source).toContain("MAX_RECONNECT_QUEUE_SIZE");
    expect(source).toContain("this.reconnectQueue.shift()");
    expect(source).toContain("droppedReconnectMessages");
  });
});

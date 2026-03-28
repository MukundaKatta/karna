import { describe, it, expect, beforeEach } from "vitest";
import { GmailPubSubManager } from "../../gateway/src/integrations/gmail-pubsub.js";

describe("GmailPubSubManager", () => {
  let manager: GmailPubSubManager;

  beforeEach(() => {
    manager = new GmailPubSubManager({
      projectId: "test-project",
      topicName: "gmail-notifications",
      subscriptionName: "gmail-sub",
      userEmail: "test@example.com",
    });
  });

  it("handles push message with valid data", async () => {
    const notifications: Array<{ emailAddress: string; historyId: string }> = [];
    manager.onNotification(async (n) => {
      notifications.push(n);
    });

    const payload = { emailAddress: "test@example.com", historyId: "12345" };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");

    await manager.handlePushMessage(encoded);

    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.emailAddress).toBe("test@example.com");
    expect(notifications[0]!.historyId).toBe("12345");
  });

  it("deduplicates notifications with same historyId", async () => {
    const notifications: unknown[] = [];
    manager.onNotification(async (n) => {
      notifications.push(n);
    });

    const payload = { emailAddress: "test@example.com", historyId: "same-id" };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");

    await manager.handlePushMessage(encoded);
    await manager.handlePushMessage(encoded); // Duplicate

    expect(notifications).toHaveLength(1);
  });

  it("processes different historyIds", async () => {
    const notifications: unknown[] = [];
    manager.onNotification(async (n) => {
      notifications.push(n);
    });

    for (const id of ["id-1", "id-2", "id-3"]) {
      const payload = { emailAddress: "test@example.com", historyId: id };
      const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
      await manager.handlePushMessage(encoded);
    }

    expect(notifications).toHaveLength(3);
  });

  it("handles invalid base64 data gracefully", async () => {
    // Should not throw
    await manager.handlePushMessage("not-valid-base64!!!");
  });

  it("handles invalid JSON gracefully", async () => {
    const encoded = Buffer.from("not json").toString("base64");
    // Should not throw
    await manager.handlePushMessage(encoded);
  });

  it("works without a notification handler", async () => {
    const payload = { emailAddress: "test@example.com", historyId: "123" };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
    // Should not throw even without handler
    await manager.handlePushMessage(encoded);
  });
});

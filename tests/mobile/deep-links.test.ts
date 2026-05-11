import { describe, expect, it } from "vitest";

import {
  getMobileTabRoute,
  parseMobileDeepLink,
} from "../../apps/mobile/lib/deep-links.js";

describe("mobile deep links", () => {
  it("maps tab names and aliases to tab routes", () => {
    expect(getMobileTabRoute("chat")).toBe("/(tabs)/chat");
    expect(getMobileTabRoute("reminders")).toBe("/(tabs)/tasks");
    expect(getMobileTabRoute("SETTINGS")).toBe("/(tabs)/settings");
    expect(getMobileTabRoute("gateway")).toBeUndefined();
  });

  it("parses custom scheme host and query settings", () => {
    expect(
      parseMobileDeepLink(
        "karna://tasks?gatewayUrl=wss%3A%2F%2Fexample.test%2Fws&token=abc&liveVoice=true",
      ),
    ).toEqual({
      route: "/(tabs)/tasks",
      gatewayUrl: "wss://example.test/ws",
      token: "abc",
      liveVoiceEnabled: true,
    });
  });

  it("prefers explicit tab query params over path or host aliases", () => {
    expect(parseMobileDeepLink("karna://settings/memory?tab=skills")).toEqual({
      route: "/(tabs)/skills",
    });
  });

  it("parses chat drafts and task creation links", () => {
    expect(parseMobileDeepLink("karna://chat?message=hello")).toEqual({
      route: "/(tabs)/chat",
      chatDraft: "hello",
    });

    expect(parseMobileDeepLink("karna://tasks/new?title=Buy%20milk&description=2%25")).toEqual({
      route: "/(tabs)/tasks",
      newTaskTitle: "Buy milk",
      newTaskDescription: "2%",
    });
  });

  it("parses universal memory and auth callback links", () => {
    expect(parseMobileDeepLink("https://app.karna.ai/memory?search=project")).toEqual({
      route: "/(tabs)/memory",
      memorySearchQuery: "project",
    });

    expect(parseMobileDeepLink("https://app.karna.ai/auth/callback?code=abc")).toEqual({
      route: "/(tabs)/settings",
      authCode: "abc",
    });
  });
});

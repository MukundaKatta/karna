import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CHAT_SCREEN_PATH = fileURLToPath(
  new URL("../../apps/mobile/app/(tabs)/chat/index.tsx", import.meta.url),
);

describe("mobile chat keyboard avoidance", () => {
  it("keeps the composer above small iPhone keyboards", () => {
    const source = readFileSync(CHAT_SCREEN_PATH, "utf-8");

    expect(source).toContain("KeyboardAvoidingView");
    expect(source).toContain('behavior={Platform.OS === "ios" ? "padding" : "height"}');
    expect(source).toContain("keyboardVerticalOffset={90}");
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MOBILE_FILES = [
  "../../apps/mobile/app/(tabs)/chat/index.tsx",
  "../../apps/mobile/app/(tabs)/settings/index.tsx",
  "../../apps/mobile/app/(tabs)/tasks/index.tsx",
  "../../apps/mobile/components/ChatBubble.tsx",
  "../../apps/mobile/components/TaskCard.tsx",
  "../../apps/mobile/components/VoiceInput.tsx",
];

describe("mobile haptic usage", () => {
  it("routes UI haptics through named app patterns", () => {
    for (const relativePath of MOBILE_FILES) {
      const path = fileURLToPath(new URL(relativePath, import.meta.url));
      const source = readFileSync(path, "utf-8");

      expect(source, relativePath).not.toContain("expo-haptics");
      expect(source, relativePath).toContain("playHaptic");
    }
  });
});

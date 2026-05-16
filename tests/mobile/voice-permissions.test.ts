import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("mobile voice microphone permissions", () => {
  it("checks existing permission before requesting a recording permission", () => {
    const source = readFileSync(
      join(ROOT, "apps/mobile/lib/voice.ts"),
      "utf-8",
    );

    expect(source).toContain("Audio.getPermissionsAsync()");
    expect(source).toContain("getMicrophonePermissionState");
    expect(source).toContain("if (currentStatus === 'denied') return false");
  });

  it("shows an iOS settings prompt when microphone access is denied", () => {
    const source = readFileSync(
      join(ROOT, "apps/mobile/components/VoiceInput.tsx"),
      "utf-8",
    );

    expect(source).toContain("getMicrophonePermissionState");
    expect(source).toContain("showMicrophoneSettingsAlert");
    expect(source).toContain("Alert.alert");
    expect(source).toContain("Open Settings");
    expect(source).toContain("Linking.openSettings()");
  });
});

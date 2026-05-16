import { describe, expect, it } from "vitest";
import {
  buildSmsMessages,
  estimateSmsSegments,
  splitForSMS,
} from "../../channels/sms/src/adapter.js";

describe("SMS segmentation", () => {
  it("keeps short responses as one message", () => {
    expect(buildSmsMessages("short reply")).toEqual(["short reply"]);
    expect(estimateSmsSegments("a".repeat(160))).toBe(1);
    expect(estimateSmsSegments("a".repeat(161))).toBe(2);
  });

  it("limits very long responses to one Twilio concatenated SMS body", () => {
    const messages = buildSmsMessages("a".repeat(2_500));

    expect(messages).toHaveLength(1);
    expect(messages[0]!.length).toBeLessThanOrEqual(1_600);
    expect(messages[0]).toContain("[continued in Karna]");
    expect(estimateSmsSegments(messages[0]!)).toBeLessThanOrEqual(10);
  });

  it("splits at word boundaries when requested", () => {
    expect(splitForSMS("alpha beta gamma", 11)).toEqual(["alpha beta", "gamma"]);
  });
});

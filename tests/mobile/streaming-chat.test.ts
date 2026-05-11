import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("mobile streaming chat UI", () => {
  it("renders an animated caret for streaming assistant messages", () => {
    const source = readFileSync(
      join(ROOT, "apps/mobile/components/ChatBubble.tsx"),
      "utf-8",
    );

    expect(source).toContain("message.isStreaming");
    expect(source).toContain("StreamingCursor");
    expect(source).toContain("Animated.loop");
    expect(source).toContain("Streaming response");
  });

  it("buffers rapid stream deltas before store updates", () => {
    const source = readFileSync(
      join(ROOT, "apps/mobile/lib/gateway-client.ts"),
      "utf-8",
    );

    expect(source).toContain("streamDeltaBuffers");
    expect(source).toContain("appendStreamingDelta");
    expect(source).toContain("setTimeout(() =>");
    expect(source).toContain("}, 50)");
    expect(source).toContain("flushStreamingDelta");
  });
});

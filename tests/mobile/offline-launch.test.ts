import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("mobile offline launch handling", () => {
  it("preflights network state before connecting at launch", () => {
    const source = readFileSync(
      join(ROOT, "apps/mobile/app/_layout.tsx"),
      "utf-8",
    );

    expect(source).toContain("Network.getNetworkStateAsync()");
    expect(source).toContain("networkState.isConnected === false");
    expect(source).toContain("setNetworkType('offline')");
    expect(source).toContain("setStatus('disconnected')");
    expect(source).toContain("setConnectionAttempted(true)");
  });

  it("shows a retry action from the chat disconnected state", () => {
    const source = readFileSync(
      join(ROOT, "apps/mobile/app/(tabs)/chat/index.tsx"),
      "utf-8",
    );

    expect(source).toContain("handleRetryConnection");
    expect(source).toContain("Retry gateway connection");
    expect(source).toContain("Tap to retry");
    expect(source).toContain("gatewayClient.connect(gatewayUrl, gatewayToken)");
  });
});

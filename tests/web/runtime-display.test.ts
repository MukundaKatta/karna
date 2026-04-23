import { describe, expect, it } from "vitest";
import {
  formatGatewayBindAddress,
  resolveGatewayDisplayInfo,
} from "../../apps/web/lib/runtime-display";

describe("runtime display helpers", () => {
  it("formats the bind address without pretending prod is localhost", () => {
    expect(formatGatewayBindAddress("0.0.0.0", 10000)).toBe("http://0.0.0.0:10000");
  });

  it("prefers the public gateway url when one is available", () => {
    expect(
      resolveGatewayDisplayInfo(
        "0.0.0.0",
        10000,
        "https://karna-gateway.onrender.com",
      ),
    ).toEqual({
      primaryUrl: "https://karna-gateway.onrender.com",
      publicUrl: "https://karna-gateway.onrender.com",
      bindAddress: "http://0.0.0.0:10000",
    });
  });

  it("falls back to the internal bind address when the public url is unknown", () => {
    expect(resolveGatewayDisplayInfo("karna-gateway", 10000)).toEqual({
      primaryUrl: "http://karna-gateway:10000",
      publicUrl: null,
      bindAddress: "http://karna-gateway:10000",
    });
  });
});

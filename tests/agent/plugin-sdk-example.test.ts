import { describe, it, expect, vi } from "vitest";
import echoPlugin, { registerEchoPlugin } from "../../packages/plugin-sdk/examples/echo-plugin.js";

describe("Plugin SDK example", () => {
  it("registers an example tool and skill", () => {
    const registerTool = vi.fn();
    const registerSkill = vi.fn();

    registerEchoPlugin({
      registerTool,
      registerSkill,
      registerChannel: vi.fn(),
      getConfig: () => ({}),
      getLogger: () => ({ info: vi.fn() }) as any,
    });

    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(registerSkill).toHaveBeenCalledTimes(1);
  });

  it("exports a valid plugin definition", async () => {
    expect(echoPlugin.name).toBe("echo-plugin");
    expect(typeof echoPlugin.register).toBe("function");
  });
});

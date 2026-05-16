import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("webchat security hardening", () => {
  it("sanitizes markdown-rendered agent HTML with DOMPurify", async () => {
    const html = await readFile("channels/webchat/src/ui/index.html", "utf-8");
    expect(html).toContain("DOMPurify.sanitize");
    expect(html).toContain("ALLOWED_TAGS");
  });

  it("sends a restrictive content security policy from the server", async () => {
    const server = await readFile("channels/webchat/src/server.ts", "utf-8");
    expect(server).toContain("Content-Security-Policy");
    expect(server).toContain("object-src 'none'");
    expect(server).toContain("frame-ancestors 'none'");
    expect(server).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});

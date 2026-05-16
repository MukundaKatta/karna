import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("web chat responsive layout", () => {
  it("tracks the visual viewport for mobile keyboard resizing", () => {
    const source = readFileSync(join(ROOT, "apps/web/app/chat/page.tsx"), "utf-8");

    expect(source).toContain("window.visualViewport?.height");
    expect(source).toContain("--chat-viewport-height");
    expect(source).toContain('visualViewport?.addEventListener("resize"');
    expect(source).toContain('visualViewport?.addEventListener("scroll"');
  });

  it("keeps messages scrollable and composer visible on small screens", () => {
    const source = readFileSync(join(ROOT, "apps/web/app/chat/page.tsx"), "utf-8");

    expect(source).toContain("flex min-h-0 flex-col");
    expect(source).toContain("flex-1 min-h-0 overflow-y-auto");
    expect(source).toContain("overscroll-contain");
    expect(source).toContain("sticky bottom-0 shrink-0");
    expect(source).toContain("env(safe-area-inset-bottom");
  });

  it("allows the nested chat route to shrink inside the app shell", () => {
    const source = readFileSync(join(ROOT, "apps/web/app/chat/layout.tsx"), "utf-8");

    expect(source).toContain("relative flex h-full min-h-0");
    expect(source).toContain("min-w-0 min-h-0 flex-1 overflow-hidden");
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GLOBALS_PATH = fileURLToPath(
  new URL("../../apps/web/app/globals.css", import.meta.url),
);
const CLIENT_LAYOUT_PATH = fileURLToPath(
  new URL("../../apps/web/components/ClientLayout.tsx", import.meta.url),
);
const THEME_TOGGLE_PATH = fileURLToPath(
  new URL("../../apps/web/components/ThemeToggle.tsx", import.meta.url),
);

describe("web dashboard theme toggle", () => {
  it("defines light theme token overrides and transition styling", () => {
    const css = readFileSync(GLOBALS_PATH, "utf-8");

    expect(css).toContain('html[data-theme="light"]');
    expect(css).toContain("color-scheme: light");
    expect(css).toContain("transition:");
  });

  it("renders a persisted dashboard theme toggle in the app shell", () => {
    const layout = readFileSync(CLIENT_LAYOUT_PATH, "utf-8");
    const toggle = readFileSync(THEME_TOGGLE_PATH, "utf-8");

    expect(layout).toContain("<ThemeToggle />");
    expect(toggle).toContain("toggleTheme");
    expect(toggle).toContain("Switch to");
  });
});

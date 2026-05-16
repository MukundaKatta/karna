"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect } from "react";
import { useDashboardStore } from "@/lib/store";

export function ThemeToggle() {
  const { theme, toggleTheme, hydrateDashboardSettings } = useDashboardStore();

  useEffect(() => {
    hydrateDashboardSettings();
  }, [hydrateDashboardSettings]);

  const isLight = theme === "light";

  return (
    <button
      type="button"
      aria-label={`Switch to ${isLight ? "dark" : "light"} theme`}
      onClick={toggleTheme}
      className="inline-flex items-center gap-2 rounded-lg border border-dark-700 bg-dark-800/85 px-3 py-2 text-sm font-medium text-dark-100 shadow-sm backdrop-blur transition hover:border-accent-500 hover:text-accent-400"
    >
      {isLight ? <Moon size={16} /> : <Sun size={16} />}
      <span className="hidden sm:inline">{isLight ? "Dark" : "Light"}</span>
    </button>
  );
}

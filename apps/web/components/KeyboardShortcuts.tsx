"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Keyboard, MessageSquare, PanelLeft, Mic, X } from "lucide-react";
import {
  DASHBOARD_SHORTCUT_ROUTES,
  WEB_SHORTCUT_EVENTS,
  getDashboardShortcutRoute,
  isCommandModifier,
  isEditableShortcutTarget,
} from "@/lib/keyboard-shortcuts";
import { useDashboardStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const shortcutRows = [
  ["Cmd/Ctrl K", "Open command palette"],
  ["Cmd/Ctrl N", "Start a new chat"],
  ["Cmd/Ctrl /", "Toggle sidebar"],
  ["Cmd/Ctrl 1-9", "Switch dashboard pages"],
  ["Cmd/Ctrl Enter", "Send chat message"],
  ["Esc", "Close overlays or cancel"],
  ["Cmd/Ctrl Shift V", "Toggle voice mode"],
  ["?", "Show keyboard shortcuts"],
];

const commandItems = [
  { label: "Chat", href: "/chat", shortcut: "Cmd/Ctrl N", icon: MessageSquare },
  { label: "Dashboard", href: DASHBOARD_SHORTCUT_ROUTES[0], shortcut: "Cmd/Ctrl 1", icon: Keyboard },
  { label: "Agents", href: DASHBOARD_SHORTCUT_ROUTES[1], shortcut: "Cmd/Ctrl 2", icon: Keyboard },
  { label: "Sessions", href: DASHBOARD_SHORTCUT_ROUTES[2], shortcut: "Cmd/Ctrl 3", icon: Keyboard },
  { label: "Skills", href: DASHBOARD_SHORTCUT_ROUTES[3], shortcut: "Cmd/Ctrl 4", icon: Keyboard },
  { label: "Tools", href: DASHBOARD_SHORTCUT_ROUTES[4], shortcut: "Cmd/Ctrl 5", icon: Keyboard },
  { label: "Memory", href: DASHBOARD_SHORTCUT_ROUTES[5], shortcut: "Cmd/Ctrl 6", icon: Keyboard },
  { label: "Moderation", href: DASHBOARD_SHORTCUT_ROUTES[6], shortcut: "Cmd/Ctrl 7", icon: Keyboard },
  { label: "Analytics", href: DASHBOARD_SHORTCUT_ROUTES[7], shortcut: "Cmd/Ctrl 8", icon: Keyboard },
  { label: "Observability", href: DASHBOARD_SHORTCUT_ROUTES[8], shortcut: "Cmd/Ctrl 9", icon: Keyboard },
  { label: "Workflows", href: "/workflows", shortcut: "", icon: Keyboard },
  { label: "Settings", href: "/dashboard/settings", shortcut: "", icon: Keyboard },
];

export function KeyboardShortcuts() {
  const router = useRouter();
  const { toggleSidebar } = useDashboardStore();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commandItems;
    return commandItems.filter((item) => item.label.toLowerCase().includes(normalized));
  }, [query]);

  useEffect(() => {
    const closeOverlays = () => {
      setPaletteOpen(false);
      setHelpOpen(false);
      setQuery("");
    };

    window.addEventListener(WEB_SHORTCUT_EVENTS.closeOverlays, closeOverlays);
    return () => window.removeEventListener(WEB_SHORTCUT_EVENTS.closeOverlays, closeOverlays);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const commandModifier = isCommandModifier(event);
      const editableTarget = isEditableShortcutTarget(event.target);

      if (event.key === "Escape") {
        setPaletteOpen(false);
        setHelpOpen(false);
        setQuery("");
        window.dispatchEvent(new CustomEvent(WEB_SHORTCUT_EVENTS.closeOverlays));
        return;
      }

      if (commandModifier && event.key === "Enter") {
        window.dispatchEvent(new CustomEvent(WEB_SHORTCUT_EVENTS.sendChat));
        return;
      }

      if (editableTarget) {
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }

      if (!commandModifier) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        setHelpOpen(false);
        return;
      }

      if (key === "n") {
        event.preventDefault();
        router.push("/chat");
        window.dispatchEvent(new CustomEvent(WEB_SHORTCUT_EVENTS.newChat));
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        toggleSidebar();
        return;
      }

      if (event.shiftKey && key === "v") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(WEB_SHORTCUT_EVENTS.toggleVoice));
        return;
      }

      const route = getDashboardShortcutRoute(event.key);
      if (route) {
        event.preventDefault();
        router.push(route);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router, toggleSidebar]);

  const navigate = (href: string) => {
    router.push(href);
    setPaletteOpen(false);
    setQuery("");
  };

  return (
    <>
      {paletteOpen && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm">
          <div className="w-full max-w-xl overflow-hidden rounded-lg border border-dark-700 bg-dark-800 shadow-2xl">
            <div className="flex items-center gap-3 border-b border-dark-700 px-4 py-3">
              <Search size={18} className="text-dark-400" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search pages..."
                className="h-9 flex-1 bg-transparent text-sm text-dark-100 outline-none placeholder:text-dark-500"
              />
              <button
                onClick={() => setPaletteOpen(false)}
                className="rounded-md p-1.5 text-dark-400 transition-colors hover:bg-dark-700 hover:text-white"
                aria-label="Close command palette"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {filteredCommands.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.href}
                    onClick={() => navigate(item.href)}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-dark-200 transition-colors hover:bg-dark-700 hover:text-white"
                  >
                    <Icon size={16} className="text-dark-400" />
                    <span className="flex-1">{item.label}</span>
                    {item.shortcut && (
                      <kbd className="rounded border border-dark-600 bg-dark-900 px-1.5 py-0.5 text-[11px] text-dark-400">
                        {item.shortcut}
                      </kbd>
                    )}
                  </button>
                );
              })}
              {filteredCommands.length === 0 && (
                <div className="px-3 py-8 text-center text-sm text-dark-400">No matching pages</div>
              )}
            </div>
          </div>
        </div>
      )}

      {helpOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-lg border border-dark-700 bg-dark-800 shadow-2xl">
            <div className="flex items-center justify-between border-b border-dark-700 px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Keyboard size={17} />
                Keyboard Shortcuts
              </div>
              <button
                onClick={() => setHelpOpen(false)}
                className="rounded-md p-1.5 text-dark-400 transition-colors hover:bg-dark-700 hover:text-white"
                aria-label="Close keyboard shortcuts"
              >
                <X size={16} />
              </button>
            </div>
            <div className="divide-y divide-dark-700">
              {shortcutRows.map(([keys, action]) => (
                <div key={keys} className="flex items-center justify-between gap-4 px-5 py-3">
                  <span className="text-sm text-dark-300">{action}</span>
                  <kbd className="shrink-0 rounded border border-dark-600 bg-dark-900 px-2 py-1 text-xs text-dark-300">
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        className={cn(
          "fixed bottom-4 right-4 z-40 hidden items-center gap-2 rounded-lg border border-dark-700 bg-dark-800 px-3 py-2 text-xs font-medium text-dark-300 shadow-lg transition-colors hover:border-accent-500 hover:text-white md:flex",
        )}
        title="Keyboard shortcuts (?)"
      >
        <PanelLeft size={14} />
        Shortcuts
      </button>
    </>
  );
}

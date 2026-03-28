"use client";

import { cn, formatRelativeTime, truncate } from "@/lib/utils";
import { useChatStore, type ChatSessionUI } from "@/lib/store";
import { Plus, MessageSquare, Search, PanelLeftClose, PanelLeft } from "lucide-react";
import { useState, useMemo } from "react";

function SessionSidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { sessions, activeSessionId, setActiveSession } = useChatStore();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSessions = useMemo(() => {
    if (!searchQuery) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, searchQuery]);

  const handleNewSession = () => {
    const newSession: ChatSessionUI = {
      id: `session-${Date.now()}`,
      title: "New Conversation",
      channelType: "web",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
    };
    useChatStore.getState().setSessions([newSession, ...sessions]);
    setActiveSession(newSession.id);
    useChatStore.getState().clearChat();
    onClose(); // Close sidebar on mobile after selecting
  };

  const handleSelectSession = (id: string) => {
    setActiveSession(id);
    onClose(); // Close sidebar on mobile after selecting
  };

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <div
        className={cn(
          // Mobile: fixed overlay that slides in
          "fixed inset-y-0 left-0 z-40 flex flex-col w-72 border-r border-dark-700 bg-dark-800 h-full transition-transform duration-200 ease-out",
          "md:static md:translate-x-0 md:z-auto",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-dark-700 shrink-0">
          <h2 className="text-sm font-semibold text-white">Sessions</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={handleNewSession}
              className="p-1.5 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700 transition-colors"
              title="New session"
            >
              <Plus size={18} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700 transition-colors md:hidden"
              title="Close"
            >
              <PanelLeftClose size={18} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
            <input
              type="text"
              placeholder="Search sessions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm bg-dark-700 border border-dark-600 rounded-lg text-dark-200 placeholder:text-dark-500 focus:outline-none focus:border-accent-500"
            />
          </div>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {filteredSessions.length === 0 ? (
            <div className="px-3 py-8 text-center text-dark-500 text-sm">
              No sessions yet
            </div>
          ) : (
            filteredSessions.map((session) => (
              <button
                key={session.id}
                onClick={() => handleSelectSession(session.id)}
                className={cn(
                  "flex items-start gap-2.5 w-full px-3 py-3 rounded-lg text-left transition-colors",
                  activeSessionId === session.id
                    ? "bg-accent-600/10 text-accent-400"
                    : "text-dark-300 hover:bg-dark-700/50",
                )}
              >
                <MessageSquare size={16} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {truncate(session.title, 30)}
                  </p>
                  <p className="text-xs text-dark-500 mt-0.5">
                    {formatRelativeTime(session.updatedAt)}
                    {session.messageCount > 0 && ` \u00b7 ${session.messageCount} msgs`}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const [sessionSidebarOpen, setSessionSidebarOpen] = useState(false);

  return (
    <div className="flex h-full relative">
      {/* Mobile sessions toggle button */}
      <button
        onClick={() => setSessionSidebarOpen(true)}
        className="fixed bottom-20 left-3 z-20 p-2.5 rounded-full bg-dark-700 border border-dark-600 text-dark-300 hover:text-white shadow-lg md:hidden"
        aria-label="Show sessions"
      >
        <PanelLeft size={18} />
      </button>

      <SessionSidebar
        open={sessionSidebarOpen}
        onClose={() => setSessionSidebarOpen(false)}
      />
      <div className="flex-1 overflow-hidden min-w-0">{children}</div>
    </div>
  );
}

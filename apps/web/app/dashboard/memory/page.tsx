"use client";

import { useState, useMemo } from "react";
import { Search, Trash2, Brain, Tag, Clock } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Badge } from "@/components/Badge";

interface MemoryItem {
  id: string;
  content: string;
  summary?: string;
  source: string;
  priority: "low" | "normal" | "high" | "critical";
  category?: string;
  tags: string[];
  createdAt: number;
  accessCount: number;
  score?: number;
}

const demoMemories: MemoryItem[] = [
  {
    id: "mem-1",
    content: "User prefers TypeScript for all new projects and uses strict mode. They work primarily with Next.js and Node.js.",
    summary: "User tech preferences: TypeScript, Next.js, Node.js",
    source: "conversation",
    priority: "high",
    category: "preferences",
    tags: ["typescript", "nextjs", "preferences"],
    createdAt: Date.now() - 86400000,
    accessCount: 12,
    score: 0.95,
  },
  {
    id: "mem-2",
    content: "The main project uses a monorepo structure managed with pnpm workspaces and Turborepo for build orchestration.",
    summary: "Project structure: pnpm monorepo with Turborepo",
    source: "conversation",
    priority: "normal",
    category: "project",
    tags: ["monorepo", "pnpm", "turborepo"],
    createdAt: Date.now() - 172800000,
    accessCount: 8,
    score: 0.88,
  },
  {
    id: "mem-3",
    content: "Security review: The authentication module needs HMAC token verification for all API endpoints. Token expiry is set to 24 hours.",
    summary: "Auth security: HMAC tokens, 24h expiry",
    source: "tool_result",
    priority: "high",
    category: "security",
    tags: ["auth", "security", "hmac"],
    createdAt: Date.now() - 259200000,
    accessCount: 5,
    score: 0.82,
  },
  {
    id: "mem-4",
    content: "User's timezone is IST (UTC+5:30). Prefers 24-hour time format in logs and dashboards.",
    source: "user_feedback",
    priority: "normal",
    category: "preferences",
    tags: ["timezone", "formatting"],
    createdAt: Date.now() - 345600000,
    accessCount: 3,
    score: 0.75,
  },
  {
    id: "mem-5",
    content: "Database schema uses snake_case for column names, camelCase for TypeScript interfaces. Auto-generated timestamps use Unix epoch in milliseconds.",
    source: "conversation",
    priority: "normal",
    category: "conventions",
    tags: ["database", "naming", "conventions"],
    createdAt: Date.now() - 432000000,
    accessCount: 6,
    score: 0.71,
  },
  {
    id: "mem-6",
    content: "The gateway WebSocket server runs on port 4000 in development. CORS is configured to allow all origins in dev mode.",
    source: "system",
    priority: "low",
    category: "config",
    tags: ["gateway", "websocket", "cors"],
    createdAt: Date.now() - 518400000,
    accessCount: 2,
    score: 0.65,
  },
];

const allCategories = [...new Set(demoMemories.map((m) => m.category).filter(Boolean))] as string[];

export default function MemoryPage() {
  const [memories, setMemories] = useState<MemoryItem[]>(demoMemories);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const filtered = useMemo(() => {
    return memories.filter((m) => {
      if (categoryFilter && m.category !== categoryFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          m.content.toLowerCase().includes(q) ||
          m.summary?.toLowerCase().includes(q) ||
          m.tags.some((t) => t.includes(q))
        );
      }
      return true;
    });
  }, [memories, search, categoryFilter]);

  const deleteMemory = (id: string) => {
    setMemories(memories.filter((m) => m.id !== id));
  };

  const stats = useMemo(() => {
    const categoryCounts: Record<string, number> = {};
    memories.forEach((m) => {
      const cat = m.category ?? "uncategorized";
      categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
    });
    return { total: memories.length, categories: categoryCounts };
  }, [memories]);

  const priorityVariant = (p: string) => {
    switch (p) {
      case "critical": return "danger" as const;
      case "high": return "warning" as const;
      case "normal": return "info" as const;
      default: return "default" as const;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Memory</h1>
        <p className="text-sm text-dark-400 mt-1">Browse and manage agent memory entries</p>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-4">
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-4 py-3 flex items-center gap-3">
          <Brain size={18} className="text-accent-400" />
          <div>
            <p className="text-xs text-dark-400">Total Memories</p>
            <p className="text-lg font-semibold text-white">{stats.total}</p>
          </div>
        </div>
        {Object.entries(stats.categories).map(([cat, count]) => (
          <div key={cat} className="rounded-xl border border-dark-700 bg-dark-800 px-4 py-3 flex items-center gap-3">
            <Tag size={16} className="text-dark-400" />
            <div>
              <p className="text-xs text-dark-400 capitalize">{cat}</p>
              <p className="text-lg font-semibold text-white">{count}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Search and filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[250px] max-w-lg">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
          <input
            type="text"
            placeholder="Semantic search across memories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm bg-dark-800 border border-dark-700 rounded-lg text-dark-200 placeholder:text-dark-500 focus:outline-none focus:border-accent-500"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 text-sm bg-dark-800 border border-dark-700 rounded-lg text-dark-200 focus:outline-none focus:border-accent-500"
        >
          <option value="">All Categories</option>
          {allCategories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Results grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((mem) => (
          <div
            key={mem.id}
            className="rounded-xl border border-dark-700 bg-dark-800 p-4 space-y-3"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <Badge variant={priorityVariant(mem.priority)}>{mem.priority}</Badge>
                <Badge variant="default">{mem.source}</Badge>
                {mem.category && <Badge variant="accent">{mem.category}</Badge>}
              </div>
              {mem.score !== undefined && (
                <span className="text-xs text-dark-500">
                  {(mem.score * 100).toFixed(0)}% match
                </span>
              )}
            </div>

            {mem.summary && (
              <p className="text-sm font-medium text-dark-200">{mem.summary}</p>
            )}
            <p className="text-sm text-dark-300 line-clamp-3">{mem.content}</p>

            <div className="flex flex-wrap gap-1.5">
              {mem.tags.map((tag) => (
                <span key={tag} className="px-2 py-0.5 text-xs bg-dark-700 text-dark-400 rounded-md">
                  {tag}
                </span>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-dark-700">
              <div className="flex items-center gap-3 text-xs text-dark-500">
                <span className="flex items-center gap-1">
                  <Clock size={12} />
                  {formatRelativeTime(mem.createdAt)}
                </span>
                <span>{mem.accessCount} accesses</span>
              </div>
              <button
                onClick={() => deleteMemory(mem.id)}
                className="p-1.5 rounded-md text-dark-500 hover:text-danger-400 hover:bg-dark-700 transition-colors"
                title="Delete memory"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-2 py-12 text-center text-dark-500">
            No memories found matching your search
          </div>
        )}
      </div>
    </div>
  );
}

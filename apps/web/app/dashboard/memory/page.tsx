"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Trash2, Brain, Tag, Clock } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { Badge } from "@/components/Badge";

interface MemoryItem {
  id: string;
  agentId: string;
  content: string;
  summary?: string;
  source: string;
  priority: "low" | "normal" | "high" | "critical";
  category?: string;
  tags: string[];
  createdAt: number;
  accessCount: number;
  accessedAt: number;
}

export default function MemoryPage() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchMemories() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/memory?limit=500", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Memory request failed with ${response.status}`);
        }

        const payload = (await response.json()) as { entries?: MemoryItem[] };
        if (cancelled) return;
        setMemories(payload.entries ?? []);
      } catch (fetchError) {
        if (cancelled) return;
        setMemories([]);
        setError(
          fetchError instanceof Error ? fetchError.message : "Failed to load live memory entries",
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchMemories();

    return () => {
      cancelled = true;
    };
  }, []);

  const allCategories = useMemo(
    () => [...new Set(memories.map((memory) => memory.category).filter(Boolean))] as string[],
    [memories],
  );
  const allSources = useMemo(
    () => [...new Set(memories.map((memory) => memory.source))].sort(),
    [memories],
  );
  const allAgents = useMemo(
    () => [...new Set(memories.map((memory) => memory.agentId))].sort(),
    [memories],
  );

  const filtered = useMemo(
    () =>
      memories.filter((memory) => {
        if (categoryFilter && memory.category !== categoryFilter) return false;
        if (sourceFilter && memory.source !== sourceFilter) return false;
        if (agentFilter && memory.agentId !== agentFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          return (
            memory.content.toLowerCase().includes(q) ||
            memory.summary?.toLowerCase().includes(q) ||
            memory.tags.some((tag) => tag.toLowerCase().includes(q))
          );
        }
        return true;
      }),
    [agentFilter, categoryFilter, memories, search, sourceFilter],
  );

  const deleteMemory = async (id: string) => {
    try {
      const response = await fetch(`/api/memory/${id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`Delete request failed with ${response.status}`);
      }
      setMemories((current) => current.filter((memory) => memory.id !== id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete memory");
    }
  };

  const stats = useMemo(() => {
    const categoryCounts: Record<string, number> = {};
    memories.forEach((memory) => {
      const category = memory.category ?? "uncategorized";
      categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
    });
    return { total: memories.length, categories: categoryCounts };
  }, [memories]);

  const priorityVariant = (priority: string) => {
    switch (priority) {
      case "critical":
        return "danger" as const;
      case "high":
        return "warning" as const;
      case "normal":
        return "info" as const;
      default:
        return "default" as const;
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full">
      {error && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          {error}
        </div>
      )}

      <div>
        <h1 className="text-xl font-semibold text-white">Memory</h1>
        <p className="text-sm text-dark-400 mt-1">Browse and manage live agent memory entries</p>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-4 py-3 flex items-center gap-3">
          <Brain size={18} className="text-accent-400" />
          <div>
            <p className="text-xs text-dark-400">Total Memories</p>
            <p className="text-lg font-semibold text-white">{stats.total}</p>
          </div>
        </div>
        {Object.entries(stats.categories).map(([category, count]) => (
          <div
            key={category}
            className="rounded-xl border border-dark-700 bg-dark-800 px-4 py-3 flex items-center gap-3"
          >
            <Tag size={16} className="text-dark-400" />
            <div>
              <p className="text-xs text-dark-400 capitalize">{category}</p>
              <p className="text-lg font-semibold text-white">{count}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[250px] max-w-lg">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
          <input
            type="text"
            placeholder="Search across memories..."
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
          {allCategories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="px-3 py-2 text-sm bg-dark-800 border border-dark-700 rounded-lg text-dark-200 focus:outline-none focus:border-accent-500"
        >
          <option value="">All Sources</option>
          {allSources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="px-3 py-2 text-sm bg-dark-800 border border-dark-700 rounded-lg text-dark-200 focus:outline-none focus:border-accent-500"
        >
          <option value="">All Agents</option>
          {allAgents.map((agentId) => (
            <option key={agentId} value={agentId}>
              {agentId}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          Loading live memory entries...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((memory) => (
            <div
              key={memory.id}
              className="rounded-xl border border-dark-700 bg-dark-800 p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={priorityVariant(memory.priority)}>{memory.priority}</Badge>
                  <Badge variant="default">{memory.source}</Badge>
                  {memory.category && <Badge variant="accent">{memory.category}</Badge>}
                  <Badge variant="info">{memory.agentId}</Badge>
                </div>
              </div>

              {memory.summary && (
                <p className="text-sm font-medium text-dark-200">{memory.summary}</p>
              )}
              <p className="text-sm text-dark-300 line-clamp-3">{memory.content}</p>

              <div className="flex flex-wrap gap-1.5">
                {memory.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 text-xs bg-dark-700 text-dark-400 rounded-md"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-dark-700">
                <div className="flex items-center gap-3 text-xs text-dark-500 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Clock size={12} />
                    {formatRelativeTime(memory.createdAt)}
                  </span>
                  <span>{memory.accessCount} accesses</span>
                  <span>Last touched {formatRelativeTime(memory.accessedAt)}</span>
                </div>
                <button
                  onClick={() => void deleteMemory(memory.id)}
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
              No memories found matching your filters
            </div>
          )}
        </div>
      )}
    </div>
  );
}

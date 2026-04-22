"use client";

import { useEffect, useMemo, useState } from "react";
import { Puzzle, Search, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/Badge";
import { Modal } from "@/components/Modal";

interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  category?: string;
  author?: string;
  triggers: number;
  actions: number;
  tags: string[];
  source: "builtin" | "community";
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [search, setSearch] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchSkills() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/skills", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Skill request failed with ${response.status}`);
        }

        const payload = (await response.json()) as { skills?: Skill[] };
        if (cancelled) return;
        setSkills(payload.skills ?? []);
      } catch (fetchError) {
        if (cancelled) return;
        setSkills([]);
        setError(
          fetchError instanceof Error ? fetchError.message : "Failed to load live skill catalog",
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchSkills();

    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(
    () => [...new Set(skills.map((skill) => skill.category).filter(Boolean))] as string[],
    [skills],
  );

  const filtered = useMemo(
    () =>
      skills.filter((skill) => {
        if (categoryFilter && skill.category !== categoryFilter) return false;
        if (sourceFilter && skill.source !== sourceFilter) return false;
        if (search) {
          const query = search.toLowerCase();
          return (
            skill.name.toLowerCase().includes(query) ||
            skill.description.toLowerCase().includes(query) ||
            skill.tags.some((tag) => tag.toLowerCase().includes(query))
          );
        }
        return true;
      }),
    [categoryFilter, search, skills, sourceFilter],
  );

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full">
      {error && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          {error}
        </div>
      )}

      <div>
        <h1 className="text-xl font-semibold text-white">Skills</h1>
        <p className="text-sm text-dark-400 mt-1">Browse the live installed skill catalog</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
          <input
            type="text"
            placeholder="Search skills..."
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
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="px-3 py-2 text-sm bg-dark-800 border border-dark-700 rounded-lg text-dark-200 focus:outline-none focus:border-accent-500"
        >
          <option value="">All Sources</option>
          <option value="builtin">Builtin</option>
          <option value="community">Community</option>
        </select>
      </div>

      {/* Skill grid */}
      {isLoading ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          Loading skill catalog...
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((skill) => (
            <div
              key={skill.id}
              className={cn(
                "rounded-xl border bg-dark-800 p-5 space-y-3 transition-colors",
                skill.enabled ? "border-dark-700" : "border-dark-700/50 opacity-60",
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-dark-700">
                    <Puzzle size={20} className="text-accent-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">{skill.name}</h3>
                    <p className="text-xs text-dark-500">v{skill.version}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={skill.enabled ? "success" : "default"}>
                    {skill.enabled ? "enabled" : "disabled"}
                  </Badge>
                  <Badge variant={skill.source === "builtin" ? "info" : "accent"}>
                    {skill.source}
                  </Badge>
                </div>
              </div>

              <p className="text-sm text-dark-300 line-clamp-2">{skill.description}</p>

              <div className="grid grid-cols-2 gap-3 text-xs text-dark-400">
                <div className="rounded-lg bg-dark-700/40 px-3 py-2">
                  <p>Actions</p>
                  <p className="text-sm font-semibold text-white">{skill.actions}</p>
                </div>
                <div className="rounded-lg bg-dark-700/40 px-3 py-2">
                  <p>Triggers</p>
                  <p className="text-sm font-semibold text-white">{skill.triggers}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {skill.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 text-xs bg-dark-700 text-dark-400 rounded-md"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-dark-700">
                <div className="flex items-center gap-1.5 text-xs text-dark-500">
                  {skill.category && <Badge variant="default">{skill.category}</Badge>}
                  {skill.author && <span>by {skill.author}</span>}
                </div>
                <button
                  onClick={() => setSelectedSkill(skill)}
                  className="p-1.5 rounded-md text-dark-400 hover:text-white hover:bg-dark-700 transition-colors"
                  title="View details"
                >
                  <Info size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          No skills matched your filters.
        </div>
      )}

      {/* Skill detail modal */}
      <Modal
        open={!!selectedSkill}
        onClose={() => setSelectedSkill(null)}
        title={selectedSkill?.name ?? ""}
        size="lg"
      >
        {selectedSkill && (
          <div className="space-y-5">
            <div>
              <p className="text-sm text-dark-300">{selectedSkill.description}</p>
              <div className="flex items-center gap-3 mt-2 text-xs text-dark-500">
                <span>v{selectedSkill.version}</span>
                {selectedSkill.author && <span>by {selectedSkill.author}</span>}
                {selectedSkill.category && <Badge variant="default">{selectedSkill.category}</Badge>}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-white mb-2">Capabilities</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-dark-700/50 px-3 py-3">
                  <p className="text-xs text-dark-400">Actions</p>
                  <p className="text-lg font-semibold text-white">{selectedSkill.actions}</p>
                </div>
                <div className="rounded-lg bg-dark-700/50 px-3 py-3">
                  <p className="text-xs text-dark-400">Triggers</p>
                  <p className="text-lg font-semibold text-white">{selectedSkill.triggers}</p>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-white mb-2">Tags</h4>
              <div className="flex flex-wrap gap-1.5">
                {selectedSkill.tags.map((tag) => (
                  <Badge key={tag} variant="default">{tag}</Badge>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

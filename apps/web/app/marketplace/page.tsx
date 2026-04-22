"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  Puzzle,
  Code,
  Globe,
  Briefcase,
  Monitor,
  MessageCircle,
  Zap,
  FileText,
  GitBranch,
  Database,
  Mail,
  Shield,
  Terminal,
} from "lucide-react";
import { Badge } from "@/components/Badge";

interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  author?: string;
  version: string;
  enabled: boolean;
  category?: string;
  source: "builtin" | "community";
  actions: number;
  triggers: number;
  tags: string[];
}

function getCategoryIcon(category?: string) {
  switch ((category ?? "").toLowerCase()) {
    case "development":
      return <Code size={20} />;
    case "research":
      return <Globe size={20} />;
    case "productivity":
      return <Briefcase size={20} />;
    case "system":
      return <Monitor size={20} />;
    case "communication":
      return <MessageCircle size={20} />;
    case "automation":
      return <Zap size={20} />;
    case "documentation":
      return <FileText size={20} />;
    case "git":
      return <GitBranch size={20} />;
    case "data":
      return <Database size={20} />;
    case "email":
      return <Mail size={20} />;
    case "security":
      return <Shield size={20} />;
    case "terminal":
      return <Terminal size={20} />;
    default:
      return <Puzzle size={20} />;
  }
}

export default function MarketplacePage() {
  const [skills, setSkills] = useState<MarketplaceSkill[]>([]);
  const [search, setSearch] = useState("");
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
          throw new Error(`Marketplace request failed with ${response.status}`);
        }

        const payload = (await response.json()) as { skills?: MarketplaceSkill[] };
        if (cancelled) return;
        setSkills(payload.skills ?? []);
      } catch (fetchError) {
        if (cancelled) return;
        setSkills([]);
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load live marketplace catalog",
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
          const q = search.toLowerCase();
          return (
            skill.name.toLowerCase().includes(q) ||
            skill.description.toLowerCase().includes(q) ||
            skill.tags.some((tag) => tag.toLowerCase().includes(q))
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
        <h1 className="text-xl font-semibold text-white">KarnaHub Skill Catalog</h1>
        <p className="text-sm text-dark-400 mt-1">
          Browse the live built-in and community skill inventory from the gateway
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <p className="text-xs text-dark-400 mb-1">Total Skills</p>
          <p className="text-xl font-semibold text-white">{skills.length}</p>
        </div>
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <p className="text-xs text-dark-400 mb-1">Built-in</p>
          <p className="text-xl font-semibold text-white">
            {skills.filter((skill) => skill.source === "builtin").length}
          </p>
        </div>
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <p className="text-xs text-dark-400 mb-1">Enabled</p>
          <p className="text-xl font-semibold text-green-400">
            {skills.filter((skill) => skill.enabled).length}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500"
          />
          <input
            type="text"
            placeholder="Search marketplace..."
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
          {categories.map((category) => (
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
          <option value="builtin">Built-in</option>
          <option value="community">Community</option>
        </select>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          Loading live skill catalog...
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((skill) => (
            <Link
              key={skill.id}
              href={`/marketplace/${skill.id}`}
              className="rounded-xl border border-dark-700 bg-dark-800 p-5 space-y-4 transition-colors hover:border-accent-500/50 hover:bg-dark-800/80 block"
            >
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-dark-700 text-accent-400 shrink-0">
                  {getCategoryIcon(skill.category)}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-white truncate">{skill.name}</h3>
                  <p className="text-xs text-dark-500">
                    by {skill.author || "Karna Community"}
                  </p>
                </div>
                <Badge variant={skill.source === "builtin" ? "info" : "accent"}>
                  {skill.source}
                </Badge>
              </div>

              <p className="text-sm text-dark-300 line-clamp-3">{skill.description}</p>

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
                {skill.tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 text-xs bg-dark-700 text-dark-400 rounded-md"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-dark-700 text-xs">
                <div className="flex items-center gap-2">
                  {skill.category && <Badge variant="default">{skill.category}</Badge>}
                  <span className="text-dark-500">v{skill.version}</span>
                </div>
                <Badge variant={skill.enabled ? "success" : "default"}>
                  {skill.enabled ? "enabled" : "disabled"}
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          No skills matched your filters.
        </div>
      )}
    </div>
  );
}

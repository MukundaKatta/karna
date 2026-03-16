"use client";

import { useState } from "react";
import { Puzzle, Search, Power, Info, Tag } from "lucide-react";
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
  triggers: Array<{ type: string; value: string; description?: string }>;
  actions: Array<{ name: string; description: string }>;
  tags: string[];
}

const demoSkills: Skill[] = [
  {
    id: "code-review",
    name: "Code Review",
    description: "Automated code review with best practices checking, security analysis, and improvement suggestions.",
    version: "1.2.0",
    enabled: true,
    category: "Development",
    author: "Karna Core",
    triggers: [
      { type: "command", value: "/review", description: "Trigger via /review command" },
      { type: "pattern", value: "review (this|my) code", description: "Natural language trigger" },
    ],
    actions: [
      { name: "analyze", description: "Analyze code for issues" },
      { name: "suggest", description: "Generate improvement suggestions" },
    ],
    tags: ["code", "review", "quality"],
  },
  {
    id: "web-research",
    name: "Web Research",
    description: "Search the web, scrape pages, and synthesize information into comprehensive reports.",
    version: "1.0.3",
    enabled: true,
    category: "Research",
    author: "Karna Core",
    triggers: [
      { type: "command", value: "/research", description: "Trigger via /research command" },
      { type: "pattern", value: "research|look up|find out", description: "Natural language trigger" },
    ],
    actions: [
      { name: "search", description: "Search the web" },
      { name: "summarize", description: "Summarize findings" },
    ],
    tags: ["web", "research", "search"],
  },
  {
    id: "file-manager",
    name: "File Manager",
    description: "Read, write, and manage files with safety checks and rollback support.",
    version: "2.0.1",
    enabled: true,
    category: "System",
    author: "Karna Core",
    triggers: [
      { type: "command", value: "/files", description: "Trigger via /files command" },
      { type: "event", value: "file.requested", description: "Auto-trigger on file operations" },
    ],
    actions: [
      { name: "read", description: "Read file contents" },
      { name: "write", description: "Write to file" },
      { name: "list", description: "List directory contents" },
    ],
    tags: ["files", "system", "io"],
  },
  {
    id: "task-planner",
    name: "Task Planner",
    description: "Break down complex tasks into manageable steps and track progress.",
    version: "0.9.0",
    enabled: false,
    category: "Productivity",
    author: "Community",
    triggers: [
      { type: "command", value: "/plan", description: "Trigger via /plan command" },
    ],
    actions: [
      { name: "create_plan", description: "Create a task plan" },
      { name: "update_status", description: "Update task status" },
    ],
    tags: ["tasks", "planning", "productivity"],
  },
  {
    id: "memory-manager",
    name: "Memory Manager",
    description: "Store, query, and manage long-term memory entries for persistent context.",
    version: "1.1.0",
    enabled: true,
    category: "System",
    author: "Karna Core",
    triggers: [
      { type: "command", value: "/remember", description: "Store a memory" },
      { type: "command", value: "/recall", description: "Query memories" },
      { type: "event", value: "session.end", description: "Auto-summarize on session end" },
    ],
    actions: [
      { name: "store", description: "Store a new memory" },
      { name: "query", description: "Search memories" },
      { name: "forget", description: "Remove a memory" },
    ],
    tags: ["memory", "context", "persistence"],
  },
  {
    id: "git-ops",
    name: "Git Operations",
    description: "Manage git repositories: commits, branches, diffs, and pull requests.",
    version: "1.3.0",
    enabled: false,
    category: "Development",
    author: "Community",
    triggers: [
      { type: "command", value: "/git", description: "Trigger via /git command" },
    ],
    actions: [
      { name: "status", description: "Show git status" },
      { name: "commit", description: "Create a commit" },
      { name: "diff", description: "Show changes" },
    ],
    tags: ["git", "vcs", "development"],
  },
];

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>(demoSkills);
  const [search, setSearch] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("");

  const categories = [...new Set(skills.map((s) => s.category).filter(Boolean))];

  const filtered = skills.filter((s) => {
    if (categoryFilter && s.category !== categoryFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some((t) => t.includes(q))
      );
    }
    return true;
  });

  const toggleSkill = (id: string) => {
    setSkills(
      skills.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Skills</h1>
        <p className="text-sm text-dark-400 mt-1">Browse and manage installed skills</p>
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
      </div>

      {/* Skill grid */}
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
              <button
                onClick={() => toggleSkill(skill.id)}
                className={cn(
                  "relative w-10 h-5 rounded-full transition-colors",
                  skill.enabled ? "bg-accent-600" : "bg-dark-600",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                    skill.enabled ? "left-5.5" : "left-0.5",
                  )}
                />
              </button>
            </div>

            <p className="text-sm text-dark-300 line-clamp-2">{skill.description}</p>

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
              <h4 className="text-sm font-medium text-white mb-2">Triggers</h4>
              <div className="space-y-2">
                {selectedSkill.triggers.map((t, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-dark-700/50">
                    <Badge variant="accent">{t.type}</Badge>
                    <code className="text-xs text-dark-200">{t.value}</code>
                    {t.description && (
                      <span className="text-xs text-dark-500 ml-auto">{t.description}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-white mb-2">Actions</h4>
              <div className="space-y-2">
                {selectedSkill.actions.map((a) => (
                  <div key={a.name} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-dark-700/50">
                    <code className="text-xs text-accent-400 font-medium">{a.name}</code>
                    <span className="text-xs text-dark-400">{a.description}</span>
                  </div>
                ))}
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

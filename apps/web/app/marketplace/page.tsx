"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Search,
  Star,
  Download,
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
import { cn } from "@/lib/utils";
import { Badge } from "@/components/Badge";

interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  rating: number;
  downloads: number;
  price: "free" | number;
  category: string;
  icon: React.ReactNode;
  tags: string[];
}

const categories = [
  "All",
  "Development",
  "Research",
  "Productivity",
  "System",
  "Communication",
  "Automation",
];

const demoSkills: MarketplaceSkill[] = [
  {
    id: "code-review-pro",
    name: "Code Review Pro",
    description:
      "Advanced code review with security scanning, performance analysis, and auto-fix suggestions. Supports 20+ languages.",
    author: "Karna Labs",
    version: "2.1.0",
    rating: 4.8,
    downloads: 12400,
    price: "free",
    category: "Development",
    icon: <Code size={20} />,
    tags: ["code", "review", "security"],
  },
  {
    id: "web-researcher",
    name: "Web Researcher",
    description:
      "Deep web research with multi-source synthesis, citation tracking, and structured report generation.",
    author: "ResearchAI",
    version: "1.5.2",
    rating: 4.6,
    downloads: 8700,
    price: "free",
    category: "Research",
    icon: <Globe size={20} />,
    tags: ["research", "web", "reports"],
  },
  {
    id: "project-planner",
    name: "Project Planner",
    description:
      "Break down projects into milestones and tasks with timeline estimation, dependency tracking, and progress reports.",
    author: "ProductivityKit",
    version: "1.0.8",
    rating: 4.4,
    downloads: 5200,
    price: "free",
    category: "Productivity",
    icon: <Briefcase size={20} />,
    tags: ["planning", "tasks", "milestones"],
  },
  {
    id: "system-monitor",
    name: "System Monitor",
    description:
      "Real-time system health monitoring with CPU, memory, disk alerts and automated diagnostics.",
    author: "Karna Labs",
    version: "1.3.1",
    rating: 4.7,
    downloads: 9800,
    price: "free",
    category: "System",
    icon: <Monitor size={20} />,
    tags: ["system", "monitoring", "alerts"],
  },
  {
    id: "slack-bridge",
    name: "Slack Bridge",
    description:
      "Seamless Slack integration for sending messages, managing channels, and responding to mentions.",
    author: "CommTools",
    version: "2.0.0",
    rating: 4.3,
    downloads: 6100,
    price: "free",
    category: "Communication",
    icon: <MessageCircle size={20} />,
    tags: ["slack", "messaging", "notifications"],
  },
  {
    id: "workflow-automator",
    name: "Workflow Automator",
    description:
      "Create multi-step automation workflows with conditional logic, retries, and scheduled execution.",
    author: "AutomateHQ",
    version: "1.2.4",
    rating: 4.5,
    downloads: 7300,
    price: "free",
    category: "Automation",
    icon: <Zap size={20} />,
    tags: ["automation", "workflows", "scheduling"],
  },
  {
    id: "doc-generator",
    name: "Doc Generator",
    description:
      "Generate technical documentation from codebases including API docs, README files, and architecture diagrams.",
    author: "DevDocs",
    version: "1.1.0",
    rating: 4.2,
    downloads: 4500,
    price: "free",
    category: "Development",
    icon: <FileText size={20} />,
    tags: ["docs", "api", "documentation"],
  },
  {
    id: "git-wizard",
    name: "Git Wizard",
    description:
      "Advanced git operations: interactive rebase helpers, conflict resolution, branch strategy recommendations.",
    author: "Karna Labs",
    version: "1.4.0",
    rating: 4.9,
    downloads: 15200,
    price: "free",
    category: "Development",
    icon: <GitBranch size={20} />,
    tags: ["git", "vcs", "branches"],
  },
  {
    id: "data-pipeline",
    name: "Data Pipeline",
    description:
      "Build and run data transformation pipelines with support for CSV, JSON, SQL, and API sources.",
    author: "DataFlow",
    version: "0.9.5",
    rating: 4.1,
    downloads: 3200,
    price: "free",
    category: "Automation",
    icon: <Database size={20} />,
    tags: ["data", "etl", "pipeline"],
  },
  {
    id: "email-assistant",
    name: "Email Assistant",
    description:
      "Draft, summarize, and manage emails with smart categorization and follow-up reminders.",
    author: "CommTools",
    version: "1.0.2",
    rating: 4.0,
    downloads: 2800,
    price: "free",
    category: "Communication",
    icon: <Mail size={20} />,
    tags: ["email", "drafts", "productivity"],
  },
  {
    id: "security-scanner",
    name: "Security Scanner",
    description:
      "Scan codebases for vulnerabilities, dependency issues, and secrets leaks with OWASP compliance checks.",
    author: "SecureAI",
    version: "2.2.1",
    rating: 4.7,
    downloads: 11000,
    price: "free",
    category: "Development",
    icon: <Shield size={20} />,
    tags: ["security", "scanning", "vulnerabilities"],
  },
  {
    id: "terminal-recorder",
    name: "Terminal Recorder",
    description:
      "Record, replay, and share terminal sessions with annotations and step-by-step explanations.",
    author: "DevDocs",
    version: "1.0.0",
    rating: 3.9,
    downloads: 1900,
    price: "free",
    category: "System",
    icon: <Terminal size={20} />,
    tags: ["terminal", "recording", "sharing"],
  },
];

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={12}
          className={cn(
            star <= Math.round(rating)
              ? "text-yellow-400 fill-yellow-400"
              : "text-dark-600",
          )}
        />
      ))}
      <span className="text-xs text-dark-400 ml-1">{rating.toFixed(1)}</span>
    </div>
  );
}

function formatDownloads(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}

export default function MarketplacePage() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");

  const filtered = demoSkills.filter((skill) => {
    if (categoryFilter !== "All" && skill.category !== categoryFilter)
      return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        skill.name.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q) ||
        skill.tags.some((t) => t.includes(q))
      );
    }
    return true;
  });

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-white">
          KarnaHub Marketplace
        </h1>
        <p className="text-sm text-dark-400 mt-1">
          Discover and install community skills
        </p>
      </div>

      {/* Filters */}
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
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* Skill Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((skill) => (
          <Link
            key={skill.id}
            href={`/marketplace/${skill.id}`}
            className="rounded-xl border border-dark-700 bg-dark-800 p-5 space-y-3 transition-colors hover:border-accent-500/50 hover:bg-dark-800/80 block"
          >
            {/* Header */}
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-dark-700 text-accent-400 shrink-0">
                {skill.icon}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-white truncate">
                  {skill.name}
                </h3>
                <p className="text-xs text-dark-500">by {skill.author}</p>
              </div>
            </div>

            {/* Description */}
            <p className="text-sm text-dark-300 line-clamp-2">
              {skill.description}
            </p>

            {/* Rating + Downloads */}
            <div className="flex items-center gap-4">
              <StarRating rating={skill.rating} />
              <div className="flex items-center gap-1 text-xs text-dark-500">
                <Download size={11} />
                <span>{formatDownloads(skill.downloads)}</span>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-dark-700">
              <div className="flex items-center gap-2">
                <Badge variant="default">{skill.category}</Badge>
                <Badge variant="success">Free</Badge>
              </div>
              <span className="px-3 py-1 text-xs font-medium rounded-lg bg-accent-600 text-white hover:bg-accent-500 transition-colors">
                Install
              </span>
            </div>
          </Link>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12">
          <Puzzle size={40} className="mx-auto text-dark-600 mb-3" />
          <p className="text-dark-400 text-sm">
            No skills found matching your search.
          </p>
        </div>
      )}
    </div>
  );
}

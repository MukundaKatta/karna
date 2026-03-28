"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Star,
  Download,
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
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/Badge";

interface SkillDetail {
  id: string;
  name: string;
  description: string;
  longDescription: string;
  author: string;
  version: string;
  rating: number;
  downloads: number;
  price: "free" | number;
  category: string;
  icon: React.ReactNode;
  tags: string[];
  triggers: Array<{ type: string; value: string; description?: string }>;
  actions: Array<{ name: string; description: string }>;
  reviews: Array<{
    user: string;
    rating: number;
    comment: string;
    date: string;
  }>;
}

const skillsData: Record<string, SkillDetail> = {
  "code-review-pro": {
    id: "code-review-pro",
    name: "Code Review Pro",
    description:
      "Advanced code review with security scanning, performance analysis, and auto-fix suggestions. Supports 20+ languages.",
    longDescription:
      "Code Review Pro provides comprehensive automated code review capabilities for your development workflow. It performs deep static analysis across 20+ programming languages, identifies security vulnerabilities using OWASP guidelines, flags performance bottlenecks, and generates actionable improvement suggestions. The skill integrates with your git workflow to automatically review pull requests and can be triggered manually for ad-hoc code reviews. It supports custom rulesets and team coding standards configuration.",
    author: "Karna Labs",
    version: "2.1.0",
    rating: 4.8,
    downloads: 12400,
    price: "free",
    category: "Development",
    icon: <Code size={24} />,
    tags: ["code", "review", "security", "static-analysis", "quality"],
    triggers: [
      {
        type: "command",
        value: "/review",
        description: "Trigger a code review on the current file or diff",
      },
      {
        type: "pattern",
        value: "review (this|my) code",
        description: "Natural language trigger for code review",
      },
      {
        type: "event",
        value: "git.pull_request",
        description: "Auto-trigger on new pull requests",
      },
    ],
    actions: [
      { name: "analyze", description: "Run full static analysis on code" },
      {
        name: "security_scan",
        description: "Scan for security vulnerabilities",
      },
      {
        name: "suggest_fixes",
        description: "Generate auto-fix suggestions for issues",
      },
      {
        name: "summarize",
        description: "Create a summary report of findings",
      },
    ],
    reviews: [
      {
        user: "alexdev",
        rating: 5,
        comment:
          "Incredible tool. Caught a SQL injection vulnerability that our team missed. The auto-fix suggestions are spot on.",
        date: "2026-03-15",
      },
      {
        user: "sarahcoder",
        rating: 5,
        comment:
          "We integrated this into our CI pipeline and it has dramatically improved our code quality. Highly recommend.",
        date: "2026-03-10",
      },
      {
        user: "devops_mike",
        rating: 4,
        comment:
          "Great tool overall. Wish it had better support for Rust but the JavaScript and Python analysis is excellent.",
        date: "2026-02-28",
      },
    ],
  },
  "web-researcher": {
    id: "web-researcher",
    name: "Web Researcher",
    description:
      "Deep web research with multi-source synthesis, citation tracking, and structured report generation.",
    longDescription:
      "Web Researcher enables comprehensive internet research capabilities with intelligent source evaluation, cross-reference verification, and structured output generation. It can search multiple sources simultaneously, extract key findings, track citations, and compile everything into well-organized reports. The skill supports various output formats including markdown reports, comparison tables, and executive summaries. It includes built-in bias detection and source credibility scoring.",
    author: "ResearchAI",
    version: "1.5.2",
    rating: 4.6,
    downloads: 8700,
    price: "free",
    category: "Research",
    icon: <Globe size={24} />,
    tags: ["research", "web", "reports", "citations", "synthesis"],
    triggers: [
      {
        type: "command",
        value: "/research",
        description: "Start a research task",
      },
      {
        type: "pattern",
        value: "research|look up|find out about",
        description: "Natural language research trigger",
      },
    ],
    actions: [
      {
        name: "search",
        description: "Search multiple web sources for information",
      },
      {
        name: "synthesize",
        description: "Combine findings into a structured report",
      },
      { name: "cite", description: "Generate citations for sources used" },
      {
        name: "compare",
        description: "Create comparison tables from multiple sources",
      },
    ],
    reviews: [
      {
        user: "researcher_jane",
        rating: 5,
        comment:
          "This has cut my research time in half. The citation tracking alone is worth it.",
        date: "2026-03-12",
      },
      {
        user: "analyst_bob",
        rating: 4,
        comment:
          "Very useful for competitive analysis. The source credibility scoring is a nice touch.",
        date: "2026-03-01",
      },
    ],
  },
  "project-planner": {
    id: "project-planner",
    name: "Project Planner",
    description:
      "Break down projects into milestones and tasks with timeline estimation, dependency tracking, and progress reports.",
    longDescription:
      "Project Planner helps you organize complex projects by automatically breaking them down into manageable milestones and tasks. It provides intelligent timeline estimation based on task complexity, tracks dependencies between tasks, and generates progress reports. The skill can integrate with popular project management tools and supports both agile and waterfall methodologies.",
    author: "ProductivityKit",
    version: "1.0.8",
    rating: 4.4,
    downloads: 5200,
    price: "free",
    category: "Productivity",
    icon: <Briefcase size={24} />,
    tags: ["planning", "tasks", "milestones", "project-management"],
    triggers: [
      {
        type: "command",
        value: "/plan",
        description: "Create or update a project plan",
      },
      {
        type: "command",
        value: "/status",
        description: "Get project status report",
      },
    ],
    actions: [
      {
        name: "create_plan",
        description: "Generate a project plan from requirements",
      },
      {
        name: "estimate",
        description: "Estimate timeline for tasks",
      },
      {
        name: "track",
        description: "Track progress against milestones",
      },
    ],
    reviews: [
      {
        user: "pm_lisa",
        rating: 4,
        comment:
          "Good for quick project breakdowns. The timeline estimates are surprisingly accurate.",
        date: "2026-03-08",
      },
    ],
  },
  "system-monitor": {
    id: "system-monitor",
    name: "System Monitor",
    description:
      "Real-time system health monitoring with CPU, memory, disk alerts and automated diagnostics.",
    longDescription:
      "System Monitor provides comprehensive system health monitoring with real-time metrics for CPU, memory, disk usage, and network activity. It includes configurable alert thresholds, automated diagnostic routines when issues are detected, and historical trend analysis. The skill can monitor both local and remote systems and supports custom metric collection.",
    author: "Karna Labs",
    version: "1.3.1",
    rating: 4.7,
    downloads: 9800,
    price: "free",
    category: "System",
    icon: <Monitor size={24} />,
    tags: ["system", "monitoring", "alerts", "diagnostics"],
    triggers: [
      {
        type: "command",
        value: "/health",
        description: "Check system health",
      },
      {
        type: "event",
        value: "system.threshold_exceeded",
        description: "Auto-trigger on threshold breach",
      },
    ],
    actions: [
      { name: "check", description: "Run system health check" },
      {
        name: "diagnose",
        description: "Run automated diagnostics",
      },
      { name: "report", description: "Generate health report" },
    ],
    reviews: [
      {
        user: "sysadmin_tom",
        rating: 5,
        comment:
          "Caught a memory leak before it took down production. The automated diagnostics are a lifesaver.",
        date: "2026-03-20",
      },
      {
        user: "devops_kate",
        rating: 4,
        comment: "Solid monitoring tool. Works great with our alert pipeline.",
        date: "2026-02-25",
      },
    ],
  },
  "slack-bridge": {
    id: "slack-bridge",
    name: "Slack Bridge",
    description:
      "Seamless Slack integration for sending messages, managing channels, and responding to mentions.",
    longDescription:
      "Slack Bridge provides full Slack integration allowing your Karna agent to send and receive messages, manage channels, respond to mentions and direct messages, and execute slash commands. It supports rich message formatting, file sharing, and thread management. The skill includes configurable response rules and can be set to auto-respond in specific channels.",
    author: "CommTools",
    version: "2.0.0",
    rating: 4.3,
    downloads: 6100,
    price: "free",
    category: "Communication",
    icon: <MessageCircle size={24} />,
    tags: ["slack", "messaging", "notifications", "integration"],
    triggers: [
      {
        type: "command",
        value: "/slack",
        description: "Send a Slack message",
      },
      {
        type: "event",
        value: "slack.mention",
        description: "Auto-respond to mentions",
      },
    ],
    actions: [
      { name: "send", description: "Send a message to a channel or user" },
      { name: "reply", description: "Reply in a thread" },
      { name: "list_channels", description: "List available channels" },
    ],
    reviews: [
      {
        user: "team_lead",
        rating: 4,
        comment:
          "Works well for automated notifications. The thread management is solid.",
        date: "2026-03-05",
      },
    ],
  },
  "workflow-automator": {
    id: "workflow-automator",
    name: "Workflow Automator",
    description:
      "Create multi-step automation workflows with conditional logic, retries, and scheduled execution.",
    longDescription:
      "Workflow Automator lets you build complex multi-step workflows with branching logic, error handling, retries, and scheduled triggers. Define workflows using a simple YAML syntax or natural language descriptions, and the skill will orchestrate the execution across multiple tools and services. It supports parallel execution, rate limiting, and comprehensive logging for debugging.",
    author: "AutomateHQ",
    version: "1.2.4",
    rating: 4.5,
    downloads: 7300,
    price: "free",
    category: "Automation",
    icon: <Zap size={24} />,
    tags: ["automation", "workflows", "scheduling", "orchestration"],
    triggers: [
      {
        type: "command",
        value: "/automate",
        description: "Create or run a workflow",
      },
      {
        type: "event",
        value: "schedule.trigger",
        description: "Scheduled workflow execution",
      },
    ],
    actions: [
      { name: "create", description: "Create a new workflow definition" },
      { name: "run", description: "Execute a workflow" },
      { name: "status", description: "Check workflow execution status" },
    ],
    reviews: [
      {
        user: "automator_pro",
        rating: 5,
        comment:
          "Replaced three separate tools with this one skill. The YAML workflow definitions are intuitive.",
        date: "2026-03-18",
      },
      {
        user: "ops_engineer",
        rating: 4,
        comment:
          "Excellent for CI/CD automation. Retry logic saved us many times.",
        date: "2026-03-02",
      },
    ],
  },
  "doc-generator": {
    id: "doc-generator",
    name: "Doc Generator",
    description:
      "Generate technical documentation from codebases including API docs, README files, and architecture diagrams.",
    longDescription:
      "Doc Generator automatically creates comprehensive technical documentation by analyzing your codebase. It generates API documentation, README files, architecture overviews, and inline code documentation. The skill understands code patterns across multiple languages and produces clear, well-structured documentation following best practices.",
    author: "DevDocs",
    version: "1.1.0",
    rating: 4.2,
    downloads: 4500,
    price: "free",
    category: "Development",
    icon: <FileText size={24} />,
    tags: ["docs", "api", "documentation", "readme"],
    triggers: [
      {
        type: "command",
        value: "/docs",
        description: "Generate documentation",
      },
      {
        type: "command",
        value: "/readme",
        description: "Generate a README file",
      },
    ],
    actions: [
      { name: "generate_api", description: "Generate API documentation" },
      { name: "generate_readme", description: "Generate README file" },
      { name: "document_code", description: "Add inline documentation" },
    ],
    reviews: [
      {
        user: "tech_writer",
        rating: 4,
        comment:
          "Good starting point for documentation. Still needs human review but saves a lot of time.",
        date: "2026-02-20",
      },
    ],
  },
  "git-wizard": {
    id: "git-wizard",
    name: "Git Wizard",
    description:
      "Advanced git operations: interactive rebase helpers, conflict resolution, branch strategy recommendations.",
    longDescription:
      "Git Wizard supercharges your git workflow with intelligent assistance for complex operations. It provides guided interactive rebasing, automated conflict resolution suggestions, branch strategy recommendations based on your team size and release cadence, and comprehensive git history analysis. The skill understands git internals deeply and can help recover from common mistakes.",
    author: "Karna Labs",
    version: "1.4.0",
    rating: 4.9,
    downloads: 15200,
    price: "free",
    category: "Development",
    icon: <GitBranch size={24} />,
    tags: ["git", "vcs", "branches", "rebase", "merge"],
    triggers: [
      {
        type: "command",
        value: "/git",
        description: "Run git operations",
      },
      {
        type: "event",
        value: "git.conflict",
        description: "Auto-trigger on merge conflicts",
      },
    ],
    actions: [
      { name: "rebase", description: "Guided interactive rebase" },
      { name: "resolve", description: "Suggest conflict resolutions" },
      { name: "analyze", description: "Analyze git history and patterns" },
      { name: "recover", description: "Recover from common git mistakes" },
    ],
    reviews: [
      {
        user: "senior_dev",
        rating: 5,
        comment:
          "The conflict resolution suggestions are shockingly good. Saved our team hours during a major merge.",
        date: "2026-03-22",
      },
      {
        user: "junior_dev",
        rating: 5,
        comment:
          "Finally understand rebasing thanks to the guided mode. Essential learning tool.",
        date: "2026-03-14",
      },
      {
        user: "team_lead_2",
        rating: 5,
        comment:
          "Branch strategy recommendations helped us standardize our workflow across teams.",
        date: "2026-03-01",
      },
    ],
  },
  "data-pipeline": {
    id: "data-pipeline",
    name: "Data Pipeline",
    description:
      "Build and run data transformation pipelines with support for CSV, JSON, SQL, and API sources.",
    longDescription:
      "Data Pipeline enables you to build, test, and run data transformation pipelines directly from your agent. It supports ingestion from CSV files, JSON APIs, SQL databases, and more. Define transformations using natural language or structured pipeline definitions, with built-in validation, error handling, and output formatting options.",
    author: "DataFlow",
    version: "0.9.5",
    rating: 4.1,
    downloads: 3200,
    price: "free",
    category: "Automation",
    icon: <Database size={24} />,
    tags: ["data", "etl", "pipeline", "transformation"],
    triggers: [
      {
        type: "command",
        value: "/pipeline",
        description: "Create or run a data pipeline",
      },
    ],
    actions: [
      { name: "ingest", description: "Ingest data from a source" },
      { name: "transform", description: "Apply data transformations" },
      { name: "export", description: "Export results to a destination" },
    ],
    reviews: [
      {
        user: "data_eng",
        rating: 4,
        comment:
          "Still in beta but already very capable. Looking forward to more connectors.",
        date: "2026-02-15",
      },
    ],
  },
  "email-assistant": {
    id: "email-assistant",
    name: "Email Assistant",
    description:
      "Draft, summarize, and manage emails with smart categorization and follow-up reminders.",
    longDescription:
      "Email Assistant streamlines your email workflow by drafting responses, summarizing long threads, categorizing incoming mail by priority and topic, and setting smart follow-up reminders. It learns your writing style and can generate contextually appropriate replies while maintaining your tone and voice.",
    author: "CommTools",
    version: "1.0.2",
    rating: 4.0,
    downloads: 2800,
    price: "free",
    category: "Communication",
    icon: <Mail size={24} />,
    tags: ["email", "drafts", "productivity", "follow-ups"],
    triggers: [
      {
        type: "command",
        value: "/email",
        description: "Draft or manage emails",
      },
      {
        type: "command",
        value: "/summarize-inbox",
        description: "Summarize unread emails",
      },
    ],
    actions: [
      { name: "draft", description: "Draft an email reply" },
      { name: "summarize", description: "Summarize an email thread" },
      { name: "categorize", description: "Categorize inbox by priority" },
    ],
    reviews: [
      {
        user: "busy_exec",
        rating: 4,
        comment:
          "The inbox summaries are a great time-saver. Draft quality is good but needs light editing.",
        date: "2026-03-06",
      },
    ],
  },
  "security-scanner": {
    id: "security-scanner",
    name: "Security Scanner",
    description:
      "Scan codebases for vulnerabilities, dependency issues, and secrets leaks with OWASP compliance checks.",
    longDescription:
      "Security Scanner provides enterprise-grade security scanning for your codebases. It detects vulnerabilities following OWASP Top 10 guidelines, identifies outdated or compromised dependencies, scans for accidentally committed secrets and API keys, and generates compliance reports. The skill supports custom security policies and integrates with CI/CD pipelines for automated scanning.",
    author: "SecureAI",
    version: "2.2.1",
    rating: 4.7,
    downloads: 11000,
    price: "free",
    category: "Development",
    icon: <Shield size={24} />,
    tags: ["security", "scanning", "vulnerabilities", "owasp", "compliance"],
    triggers: [
      {
        type: "command",
        value: "/scan",
        description: "Run a security scan",
      },
      {
        type: "event",
        value: "git.push",
        description: "Auto-scan on push",
      },
    ],
    actions: [
      { name: "scan_code", description: "Scan code for vulnerabilities" },
      { name: "scan_deps", description: "Check dependencies for issues" },
      { name: "scan_secrets", description: "Detect leaked secrets" },
      { name: "report", description: "Generate compliance report" },
    ],
    reviews: [
      {
        user: "ciso_anna",
        rating: 5,
        comment:
          "Found critical vulnerabilities that other tools missed. The OWASP compliance reports are excellent.",
        date: "2026-03-19",
      },
      {
        user: "sec_eng",
        rating: 4,
        comment:
          "Secrets detection is top-notch. Prevented several accidental API key commits.",
        date: "2026-03-07",
      },
    ],
  },
  "terminal-recorder": {
    id: "terminal-recorder",
    name: "Terminal Recorder",
    description:
      "Record, replay, and share terminal sessions with annotations and step-by-step explanations.",
    longDescription:
      "Terminal Recorder captures your terminal sessions and transforms them into shareable, annotated recordings. Perfect for creating tutorials, documenting procedures, and sharing debugging sessions with your team. The skill adds step-by-step explanations to each command, supports playback speed control, and exports in multiple formats.",
    author: "DevDocs",
    version: "1.0.0",
    rating: 3.9,
    downloads: 1900,
    price: "free",
    category: "System",
    icon: <Terminal size={24} />,
    tags: ["terminal", "recording", "sharing", "tutorials"],
    triggers: [
      {
        type: "command",
        value: "/record",
        description: "Start recording terminal session",
      },
      {
        type: "command",
        value: "/replay",
        description: "Replay a recorded session",
      },
    ],
    actions: [
      { name: "start", description: "Start recording" },
      { name: "stop", description: "Stop recording" },
      { name: "annotate", description: "Add annotations to recording" },
      { name: "export", description: "Export recording" },
    ],
    reviews: [
      {
        user: "tutor_dev",
        rating: 4,
        comment:
          "Great for onboarding. New hires can replay the setup process at their own pace.",
        date: "2026-02-18",
      },
    ],
  },
};

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={14}
          className={cn(
            star <= Math.round(rating)
              ? "text-yellow-400 fill-yellow-400"
              : "text-dark-600",
          )}
        />
      ))}
      <span className="text-sm text-dark-400 ml-1">{rating.toFixed(1)}</span>
    </div>
  );
}

function ReviewStars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={12}
          className={cn(
            star <= rating
              ? "text-yellow-400 fill-yellow-400"
              : "text-dark-600",
          )}
        />
      ))}
    </div>
  );
}

function formatDownloads(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}

export default function SkillDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [installed, setInstalled] = useState(false);

  const skill = skillsData[id];

  if (!skill) {
    return (
      <div className="p-4 sm:p-6 overflow-y-auto h-full">
        <Link
          href="/marketplace"
          className="inline-flex items-center gap-2 text-sm text-dark-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft size={16} />
          Back to Marketplace
        </Link>
        <div className="text-center py-16">
          <p className="text-dark-400">Skill not found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 overflow-y-auto h-full">
      {/* Back Link */}
      <Link
        href="/marketplace"
        className="inline-flex items-center gap-2 text-sm text-dark-400 hover:text-white transition-colors"
      >
        <ArrowLeft size={16} />
        Back to Marketplace
      </Link>

      {/* Skill Header */}
      <div className="flex flex-col sm:flex-row items-start gap-5 rounded-xl border border-dark-700 bg-dark-800 p-6">
        <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-dark-700 text-accent-400 shrink-0">
          {skill.icon}
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold text-white">{skill.name}</h1>
            <span className="text-xs text-dark-500">v{skill.version}</span>
            <Badge variant="default">{skill.category}</Badge>
            <Badge variant="success">Free</Badge>
          </div>
          <p className="text-sm text-dark-400">by {skill.author}</p>
          <div className="flex items-center gap-4">
            <StarRating rating={skill.rating} />
            <div className="flex items-center gap-1 text-sm text-dark-500">
              <Download size={13} />
              <span>{formatDownloads(skill.downloads)} downloads</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => setInstalled(!installed)}
          className={cn(
            "px-5 py-2.5 text-sm font-medium rounded-lg transition-colors shrink-0 flex items-center gap-2",
            installed
              ? "bg-dark-700 text-dark-300 border border-dark-600"
              : "bg-accent-600 text-white hover:bg-accent-500",
          )}
        >
          {installed ? (
            <>
              <Check size={16} />
              Installed
            </>
          ) : (
            "Install"
          )}
        </button>
      </div>

      {/* Description */}
      <div className="rounded-xl border border-dark-700 bg-dark-800 p-6">
        <h2 className="text-sm font-medium text-white mb-3">Description</h2>
        <p className="text-sm text-dark-300 leading-relaxed">
          {skill.longDescription}
        </p>
      </div>

      {/* Triggers */}
      <div className="rounded-xl border border-dark-700 bg-dark-800 p-6">
        <h2 className="text-sm font-medium text-white mb-3">Triggers</h2>
        <div className="space-y-2">
          {skill.triggers.map((t, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-dark-700/50"
            >
              <Badge variant="accent">{t.type}</Badge>
              <code className="text-xs text-dark-200">{t.value}</code>
              {t.description && (
                <span className="text-xs text-dark-500 ml-auto">
                  {t.description}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="rounded-xl border border-dark-700 bg-dark-800 p-6">
        <h2 className="text-sm font-medium text-white mb-3">Actions</h2>
        <div className="space-y-2">
          {skill.actions.map((a) => (
            <div
              key={a.name}
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-dark-700/50"
            >
              <code className="text-xs text-accent-400 font-medium">
                {a.name}
              </code>
              <span className="text-xs text-dark-400">{a.description}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tags */}
      <div className="rounded-xl border border-dark-700 bg-dark-800 p-6">
        <h2 className="text-sm font-medium text-white mb-3">Tags</h2>
        <div className="flex flex-wrap gap-1.5">
          {skill.tags.map((tag) => (
            <Badge key={tag} variant="default">
              {tag}
            </Badge>
          ))}
        </div>
      </div>

      {/* Reviews */}
      <div className="rounded-xl border border-dark-700 bg-dark-800 p-6">
        <h2 className="text-sm font-medium text-white mb-4">
          Reviews ({skill.reviews.length})
        </h2>
        <div className="space-y-4">
          {skill.reviews.map((review, i) => (
            <div
              key={i}
              className={cn(
                "space-y-2",
                i < skill.reviews.length - 1 &&
                  "pb-4 border-b border-dark-700",
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-7 h-7 rounded-full bg-dark-700 text-xs text-dark-300 font-medium">
                    {review.user[0].toUpperCase()}
                  </div>
                  <span className="text-sm text-dark-200 font-medium">
                    {review.user}
                  </span>
                  <ReviewStars rating={review.rating} />
                </div>
                <span className="text-xs text-dark-500">{review.date}</span>
              </div>
              <p className="text-sm text-dark-400 pl-10">{review.comment}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

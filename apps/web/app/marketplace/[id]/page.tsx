"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
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

interface SkillDetail {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  actions: number;
  triggers: number;
  category?: string;
  author?: string;
  tags: string[];
  source: "builtin" | "community";
  instructions?: string;
  triggerDefinitions: Array<{
    type: string;
    value: string;
    description?: string;
  }>;
  actionDefinitions: Array<{
    name: string;
    description?: string;
    riskLevel?: string;
  }>;
  dependencies: string[];
  requiredTools: string[];
}

function getCategoryIcon(category?: string) {
  switch ((category ?? "").toLowerCase()) {
    case "development":
      return <Code size={24} />;
    case "research":
      return <Globe size={24} />;
    case "productivity":
      return <Briefcase size={24} />;
    case "system":
      return <Monitor size={24} />;
    case "communication":
      return <MessageCircle size={24} />;
    case "automation":
      return <Zap size={24} />;
    case "documentation":
      return <FileText size={24} />;
    case "git":
      return <GitBranch size={24} />;
    case "data":
      return <Database size={24} />;
    case "email":
      return <Mail size={24} />;
    case "security":
      return <Shield size={24} />;
    case "terminal":
      return <Terminal size={24} />;
    default:
      return <Puzzle size={24} />;
  }
}

function riskVariant(riskLevel?: string) {
  switch (riskLevel) {
    case "critical":
      return "danger" as const;
    case "high":
      return "warning" as const;
    case "medium":
      return "info" as const;
    default:
      return "default" as const;
  }
}

export default function SkillDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [skill, setSkill] = useState<SkillDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchSkill() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/skills/${id}`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "Skill not found"
              : `Skill request failed with ${response.status}`,
          );
        }

        const payload = (await response.json()) as { skill?: SkillDetail };
        if (cancelled) return;
        setSkill(payload.skill ?? null);
      } catch (fetchError) {
        if (cancelled) return;
        setSkill(null);
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load skill");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchSkill();

    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="p-4 sm:p-6 space-y-6 overflow-y-auto h-full">
      <Link
        href="/marketplace"
        className="inline-flex items-center gap-2 text-sm text-dark-400 hover:text-white transition-colors"
      >
        <ArrowLeft size={16} />
        Back to Marketplace
      </Link>

      {error && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          Loading live skill detail...
        </div>
      ) : !skill ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          Skill not found.
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row items-start gap-5 rounded-xl border border-dark-700 bg-dark-800 p-6">
            <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-dark-700 text-accent-400 shrink-0">
              {getCategoryIcon(skill.category)}
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-semibold text-white">{skill.name}</h1>
                <span className="text-xs text-dark-500">v{skill.version}</span>
                <Badge variant={skill.source === "builtin" ? "info" : "accent"}>
                  {skill.source}
                </Badge>
                <Badge variant={skill.enabled ? "success" : "default"}>
                  {skill.enabled ? "enabled" : "disabled"}
                </Badge>
                {skill.category && <Badge variant="default">{skill.category}</Badge>}
              </div>
              <p className="text-sm text-dark-400">
                by {skill.author || "Karna Community"}
              </p>
              <p className="text-sm text-dark-300 leading-relaxed">{skill.description}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 shrink-0 w-full sm:w-auto">
              <div className="rounded-lg bg-dark-700/50 px-4 py-3">
                <p className="text-xs text-dark-400">Actions</p>
                <p className="text-lg font-semibold text-white">{skill.actions}</p>
              </div>
              <div className="rounded-lg bg-dark-700/50 px-4 py-3">
                <p className="text-xs text-dark-400">Triggers</p>
                <p className="text-lg font-semibold text-white">{skill.triggers}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-dark-700 bg-dark-800 p-6">
            <h2 className="text-sm font-medium text-white mb-3">Instructions</h2>
            {skill.instructions ? (
              <div className="text-sm text-dark-300 whitespace-pre-wrap leading-relaxed">
                {skill.instructions}
              </div>
            ) : (
              <p className="text-sm text-dark-400">
                No long-form instructions were published for this skill.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-dark-700 bg-dark-800 p-6">
            <h2 className="text-sm font-medium text-white mb-3">Triggers</h2>
            {skill.triggerDefinitions.length ? (
              <div className="space-y-2">
                {skill.triggerDefinitions.map((trigger) => (
                  <div
                    key={`${trigger.type}:${trigger.value}`}
                    className="flex flex-col gap-2 rounded-lg bg-dark-700/50 px-3 py-3 sm:flex-row sm:items-center"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="accent">{trigger.type}</Badge>
                      <code className="text-xs text-dark-200">{trigger.value}</code>
                    </div>
                    <span className="text-xs text-dark-500 sm:ml-auto">
                      {trigger.description ?? "No description provided"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-dark-400">No trigger metadata available.</p>
            )}
          </div>

          <div className="rounded-xl border border-dark-700 bg-dark-800 p-6">
            <h2 className="text-sm font-medium text-white mb-3">Actions</h2>
            {skill.actionDefinitions.length ? (
              <div className="space-y-2">
                {skill.actionDefinitions.map((action) => (
                  <div
                    key={action.name}
                    className="flex flex-col gap-2 rounded-lg bg-dark-700/50 px-3 py-3 sm:flex-row sm:items-center"
                  >
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-medium text-accent-400">{action.name}</code>
                      {action.riskLevel && (
                        <Badge variant={riskVariant(action.riskLevel)}>
                          {action.riskLevel}
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-dark-400 sm:ml-auto">
                      {action.description ?? "No description provided"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-dark-400">No action metadata available.</p>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-xl border border-dark-700 bg-dark-800 p-6">
              <h2 className="text-sm font-medium text-white mb-3">Dependencies</h2>
              {skill.dependencies.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {skill.dependencies.map((dependency) => (
                    <Badge key={dependency} variant="default">
                      {dependency}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-dark-400">No explicit dependencies.</p>
              )}
            </div>

            <div className="rounded-xl border border-dark-700 bg-dark-800 p-6">
              <h2 className="text-sm font-medium text-white mb-3">Required Tools</h2>
              {skill.requiredTools.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {skill.requiredTools.map((tool) => (
                    <Badge key={tool} variant="info">
                      {tool}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-dark-400">No required tools declared.</p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-dark-700 bg-dark-800 p-6">
            <h2 className="text-sm font-medium text-white mb-3">Tags</h2>
            {skill.tags.length ? (
              <div className="flex flex-wrap gap-1.5">
                {skill.tags.map((tag) => (
                  <Badge key={tag} variant="default">
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-dark-400">No tags published.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

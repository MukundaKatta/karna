"use client";

import { useEffect, useState } from "react";
import {
  Bot,
  Clock3,
  Sparkles,
  Wrench,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { Badge } from "@/components/Badge";
import { Modal } from "@/components/Modal";

interface Agent {
  id: string;
  name: string;
  description: string;
  persona: string;
  model: string;
  provider: string;
  status: "active" | "idle" | "inactive";
  specializations: string[];
  tools: string[];
  turns: number;
  activeTraces: number;
  lastTraceAt?: number;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchAgents() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/agents", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Agent request failed with ${response.status}`);
        }

        const payload = (await response.json()) as { agents?: Agent[] };
        if (cancelled) return;
        setAgents(payload.agents ?? []);
      } catch (fetchError) {
        if (cancelled) return;
        setAgents([]);
        setError(
          fetchError instanceof Error ? fetchError.message : "Failed to load live agent catalog",
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchAgents();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full">
      {error && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          {error}
        </div>
      )}

      <div>
        <div>
          <h1 className="text-xl font-semibold text-white">Agents</h1>
          <p className="text-sm text-dark-400 mt-1">
            Live agent catalog discovered from the gateway and recent traces
          </p>
        </div>
      </div>

      {/* Agent grid */}
      {isLoading ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          Loading agent catalog...
        </div>
      ) : agents.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="rounded-xl border border-dark-700 bg-dark-800 p-5 space-y-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-dark-700">
                    <Bot size={20} className="text-accent-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">{agent.name}</h3>
                    <p className="text-xs text-dark-400">
                      {agent.model} via {agent.provider}
                    </p>
                  </div>
                </div>
                <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
              </div>

              <p className="text-sm text-dark-300 line-clamp-3">
                {agent.persona || agent.description || "No persona configured."}
              </p>

              {agent.specializations.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {agent.specializations.map((specialization) => (
                    <Badge key={specialization} variant="accent">
                      {specialization}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {agent.tools.slice(0, 4).map((tool) => (
                  <span
                    key={tool}
                    className="px-2 py-0.5 text-xs bg-dark-700 text-dark-300 rounded-md"
                  >
                    {tool}
                  </span>
                ))}
                {agent.tools.length > 4 && (
                  <span className="px-2 py-0.5 text-xs bg-dark-700 text-dark-300 rounded-md">
                    +{agent.tools.length - 4} more
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3 pt-2 border-t border-dark-700 text-xs text-dark-400">
                <div className="space-y-1">
                  <p className="flex items-center gap-1">
                    <Sparkles size={12} />
                    Turns
                  </p>
                  <p className="text-sm font-semibold text-white">{agent.turns}</p>
                </div>
                <div className="space-y-1">
                  <p className="flex items-center gap-1">
                    <Clock3 size={12} />
                    Active
                  </p>
                  <p className="text-sm font-semibold text-white">{agent.activeTraces}</p>
                </div>
                <div className="space-y-1">
                  <p className="flex items-center gap-1">
                    <Wrench size={12} />
                    Tools
                  </p>
                  <p className="text-sm font-semibold text-white">{agent.tools.length}</p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-dark-700">
                <p className="text-xs text-dark-500">
                  {agent.lastTraceAt ? `Last active ${formatRelativeTime(agent.lastTraceAt)}` : "No runs yet"}
                </p>
                <button
                  onClick={() => setSelectedAgent(agent)}
                  className="px-3 py-1.5 rounded-lg bg-dark-700 text-xs text-dark-200 hover:bg-dark-600 transition-colors"
                >
                  View Details
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          No agents discovered yet.
        </div>
      )}

      {/* Edit modal */}
      <Modal
        open={!!selectedAgent}
        onClose={() => setSelectedAgent(null)}
        title={selectedAgent ? `${selectedAgent.name}` : ""}
        size="lg"
      >
        {selectedAgent && (
          <div className="space-y-5">
            <div>
              <p className="text-sm text-dark-300">
                {selectedAgent.description || selectedAgent.persona || "No description available."}
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-dark-500">
                <Badge variant={statusVariant(selectedAgent.status)}>{selectedAgent.status}</Badge>
                <Badge variant="info">{selectedAgent.provider}</Badge>
                <span>{selectedAgent.model}</span>
                {selectedAgent.lastTraceAt && (
                  <span>Last active {formatRelativeTime(selectedAgent.lastTraceAt)}</span>
                )}
              </div>
            </div>

            {selectedAgent.persona && (
              <div>
                <h4 className="text-sm font-medium text-white mb-2">Persona</h4>
                <div className="rounded-lg bg-dark-700/50 px-3 py-3 text-sm text-dark-300">
                  {selectedAgent.persona}
                </div>
              </div>
            )}

            {selectedAgent.specializations.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-white mb-2">Specializations</h4>
                <div className="flex flex-wrap gap-1.5">
                  {selectedAgent.specializations.map((specialization) => (
                    <Badge key={specialization} variant="accent">
                      {specialization}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h4 className="text-sm font-medium text-white mb-2">Tools</h4>
              {selectedAgent.tools.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {selectedAgent.tools.map((tool) => (
                    <span
                      key={tool}
                      className="px-2 py-0.5 text-xs bg-dark-700 text-dark-300 rounded-md"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg bg-dark-700/30 px-3 py-3 text-sm text-dark-400">
                  No tools configured.
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-dark-700/40 px-3 py-3">
                <p className="text-xs text-dark-400">Completed Turns</p>
                <p className="text-lg font-semibold text-white">{selectedAgent.turns}</p>
              </div>
              <div className="rounded-lg bg-dark-700/40 px-3 py-3">
                <p className="text-xs text-dark-400">Active Traces</p>
                <p className="text-lg font-semibold text-white">{selectedAgent.activeTraces}</p>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setSelectedAgent(null)}
                className="px-4 py-2 bg-dark-700 text-white text-sm font-medium rounded-lg hover:bg-dark-600 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function statusVariant(status: Agent["status"]): "success" | "warning" | "default" {
  if (status === "active") return "success";
  if (status === "idle") return "warning";
  return "default";
}

"use client";

import { useState } from "react";
import {
  Plus,
  MoreVertical,
  Bot,
  Settings,
  Trash2,
  Power,
} from "lucide-react";
import { cn, statusColor } from "@/lib/utils";
import { Badge } from "@/components/Badge";
import { Modal } from "@/components/Modal";

interface Agent {
  id: string;
  name: string;
  persona: string;
  model: string;
  status: "active" | "inactive";
  tools: string[];
  sessions: number;
  messages: number;
}

const demoAgents: Agent[] = [
  {
    id: "default",
    name: "Karna Default",
    persona: "A helpful AI assistant that can use tools and skills to complete tasks.",
    model: "claude-sonnet-4-20250514",
    status: "active",
    tools: ["file_read", "file_write", "web_search", "code_execute"],
    sessions: 156,
    messages: 4231,
  },
  {
    id: "code-review",
    name: "Code Reviewer",
    persona: "An expert code reviewer focused on quality, security, and best practices.",
    model: "claude-sonnet-4-20250514",
    status: "active",
    tools: ["file_read", "git_diff", "code_analyze"],
    sessions: 42,
    messages: 892,
  },
  {
    id: "research",
    name: "Research Assistant",
    persona: "A research-oriented assistant that gathers, synthesizes, and presents information.",
    model: "claude-sonnet-4-20250514",
    status: "inactive",
    tools: ["web_search", "web_scrape", "file_write"],
    sessions: 18,
    messages: 340,
  },
];

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>(demoAgents);
  const [showCreate, setShowCreate] = useState(false);
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    persona: "",
    model: "claude-sonnet-4-20250514",
    tools: "",
  });

  const handleCreate = () => {
    const newAgent: Agent = {
      id: `agent-${Date.now()}`,
      name: formData.name,
      persona: formData.persona,
      model: formData.model,
      status: "active",
      tools: formData.tools.split(",").map((t) => t.trim()).filter(Boolean),
      sessions: 0,
      messages: 0,
    };
    setAgents([...agents, newAgent]);
    setShowCreate(false);
    setFormData({ name: "", persona: "", model: "claude-sonnet-4-20250514", tools: "" });
  };

  const toggleAgent = (id: string) => {
    setAgents(
      agents.map((a) =>
        a.id === id
          ? { ...a, status: a.status === "active" ? "inactive" : "active" }
          : a,
      ),
    );
  };

  const deleteAgent = (id: string) => {
    setAgents(agents.filter((a) => a.id !== id));
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Agents</h1>
          <p className="text-sm text-dark-400 mt-1">Manage AI agent configurations</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-accent-600 text-white text-sm font-medium rounded-lg hover:bg-accent-500 transition-colors"
        >
          <Plus size={16} />
          New Agent
        </button>
      </div>

      {/* Agent grid */}
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
                  <p className="text-xs text-dark-400">{agent.model}</p>
                </div>
              </div>
              <Badge variant={agent.status === "active" ? "success" : "default"}>
                {agent.status}
              </Badge>
            </div>

            <p className="text-sm text-dark-300 line-clamp-2">{agent.persona}</p>

            <div className="flex flex-wrap gap-1.5">
              {agent.tools.map((tool) => (
                <span
                  key={tool}
                  className="px-2 py-0.5 text-xs bg-dark-700 text-dark-300 rounded-md"
                >
                  {tool}
                </span>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-dark-700">
              <div className="flex gap-4 text-xs text-dark-400">
                <span>{agent.sessions} sessions</span>
                <span>{agent.messages} messages</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => toggleAgent(agent.id)}
                  className="p-1.5 rounded-md text-dark-400 hover:text-white hover:bg-dark-700 transition-colors"
                  title={agent.status === "active" ? "Deactivate" : "Activate"}
                >
                  <Power size={14} />
                </button>
                <button
                  onClick={() => setEditAgent(agent)}
                  className="p-1.5 rounded-md text-dark-400 hover:text-white hover:bg-dark-700 transition-colors"
                  title="Settings"
                >
                  <Settings size={14} />
                </button>
                <button
                  onClick={() => deleteAgent(agent.id)}
                  className="p-1.5 rounded-md text-dark-400 hover:text-danger-400 hover:bg-dark-700 transition-colors"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create New Agent" size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-accent-500"
              placeholder="Agent name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1">Persona</label>
            <textarea
              value={formData.persona}
              onChange={(e) => setFormData({ ...formData, persona: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-accent-500 resize-none"
              placeholder="Describe the agent's personality and capabilities..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1">Model</label>
            <select
              value={formData.model}
              onChange={(e) => setFormData({ ...formData, model: e.target.value })}
              className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-accent-500"
            >
              <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
              <option value="claude-opus-4-20250514">Claude Opus 4</option>
              <option value="gpt-4o">GPT-4o</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1">
              Tools (comma-separated)
            </label>
            <input
              type="text"
              value={formData.tools}
              onChange={(e) => setFormData({ ...formData, tools: e.target.value })}
              className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-accent-500"
              placeholder="file_read, web_search, code_execute"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-sm text-dark-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!formData.name.trim()}
              className="px-4 py-2 bg-accent-600 text-white text-sm font-medium rounded-lg hover:bg-accent-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Create Agent
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal
        open={!!editAgent}
        onClose={() => setEditAgent(null)}
        title={editAgent ? `Edit: ${editAgent.name}` : ""}
        size="lg"
      >
        {editAgent && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1">Name</label>
              <input
                type="text"
                defaultValue={editAgent.name}
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-accent-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1">Persona</label>
              <textarea
                defaultValue={editAgent.persona}
                rows={3}
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-accent-500 resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1">Model</label>
              <select
                defaultValue={editAgent.model}
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-accent-500"
              >
                <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                <option value="claude-opus-4-20250514">Claude Opus 4</option>
                <option value="gpt-4o">GPT-4o</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-1">Sessions</label>
                <p className="text-lg font-semibold text-white">{editAgent.sessions}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-1">Messages</label>
                <p className="text-lg font-semibold text-white">{editAgent.messages}</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setEditAgent(null)}
                className="px-4 py-2 text-sm text-dark-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => setEditAgent(null)}
                className="px-4 py-2 bg-accent-600 text-white text-sm font-medium rounded-lg hover:bg-accent-500 transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

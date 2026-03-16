"use client";

import { use } from "react";
import { ArrowLeft, Clock, Hash, Coins, MessageSquare } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/Badge";
import { formatDate, formatRelativeTime, formatCost, formatTokens } from "@/lib/utils";

interface TranscriptMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  metadata?: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    toolCallId?: string;
    toolName?: string;
    latencyMs?: number;
  };
}

// Demo data
function getSessionData(id: string) {
  const messages: TranscriptMessage[] = [
    {
      id: "m1",
      role: "system",
      content: "You are Karna, a helpful AI assistant.",
      timestamp: Date.now() - 3600000,
    },
    {
      id: "m2",
      role: "user",
      content: "Can you help me analyze this code for potential issues?",
      timestamp: Date.now() - 3500000,
    },
    {
      id: "m3",
      role: "assistant",
      content: "Of course! Please share the code you'd like me to analyze, and I'll look for potential bugs, security issues, and areas for improvement.",
      timestamp: Date.now() - 3490000,
      metadata: { model: "claude-sonnet-4-20250514", inputTokens: 245, outputTokens: 42, latencyMs: 1200 },
    },
    {
      id: "m4",
      role: "user",
      content: "Here's a function that handles user authentication:\n\n```typescript\nasync function login(email: string, password: string) {\n  const user = await db.query(`SELECT * FROM users WHERE email = '${email}'`);\n  if (user && user.password === password) {\n    return createToken(user);\n  }\n  return null;\n}\n```",
      timestamp: Date.now() - 3400000,
    },
    {
      id: "m5",
      role: "tool",
      content: '{"analysis": "SQL injection vulnerability detected, plain-text password comparison"}',
      timestamp: Date.now() - 3380000,
      metadata: { toolName: "code_analyze", toolCallId: "tc-1", latencyMs: 450 },
    },
    {
      id: "m6",
      role: "assistant",
      content: "I've identified several critical security issues in this code:\n\n1. **SQL Injection**: The email is directly interpolated into the query string. Use parameterized queries instead.\n2. **Plain-text Password Comparison**: Passwords should be hashed with bcrypt or similar.\n3. **No Rate Limiting**: This function should include rate limiting to prevent brute-force attacks.\n\nHere's a safer version:\n\n```typescript\nasync function login(email: string, password: string) {\n  const user = await db.query('SELECT * FROM users WHERE email = $1', [email]);\n  if (user && await bcrypt.compare(password, user.passwordHash)) {\n    return createToken(user);\n  }\n  return null;\n}\n```",
      timestamp: Date.now() - 3370000,
      metadata: { model: "claude-sonnet-4-20250514", inputTokens: 680, outputTokens: 185, latencyMs: 2400 },
    },
  ];

  return {
    id,
    channelType: "web",
    channelId: "web-chat-1",
    status: "active" as const,
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now() - 3370000,
    stats: {
      messageCount: messages.length,
      totalInputTokens: 925,
      totalOutputTokens: 227,
      totalCostUsd: 0.0043,
      duration: 230000,
    },
    messages,
  };
}

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const session = getSessionData(id);

  const roleStyles: Record<string, string> = {
    user: "bg-accent-600/10 border-accent-600/20",
    assistant: "bg-dark-700/50 border-dark-600",
    system: "bg-dark-800 border-dark-700 italic",
    tool: "bg-dark-800 border-dark-700 font-mono text-xs",
  };

  const roleLabels: Record<string, string> = {
    user: "User",
    assistant: "Assistant",
    system: "System",
    tool: "Tool",
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link
          href="/dashboard/sessions"
          className="p-2 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700 transition-colors mt-0.5"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-white font-mono">{session.id}</h1>
            <Badge variant="success">{session.status}</Badge>
          </div>
          <p className="text-sm text-dark-400 mt-1">
            {session.channelType} / {session.channelId} &middot; Started{" "}
            {formatRelativeTime(session.createdAt)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Transcript */}
        <div className="lg:col-span-3 space-y-3">
          {session.messages.map((msg) => (
            <div
              key={msg.id}
              className={`rounded-xl border p-4 ${roleStyles[msg.role]}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      msg.role === "user"
                        ? "accent"
                        : msg.role === "assistant"
                          ? "info"
                          : msg.role === "tool"
                            ? "warning"
                            : "default"
                    }
                  >
                    {roleLabels[msg.role]}
                  </Badge>
                  {msg.metadata?.toolName && (
                    <span className="text-xs text-dark-400">
                      {msg.metadata.toolName}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-dark-500">
                  {msg.metadata?.latencyMs && (
                    <span>{msg.metadata.latencyMs}ms</span>
                  )}
                  {msg.metadata?.model && (
                    <span>{msg.metadata.model}</span>
                  )}
                  <span>{formatDate(msg.timestamp, "HH:mm:ss")}</span>
                </div>
              </div>
              <div className="text-sm text-dark-200 whitespace-pre-wrap break-words">
                {msg.content}
              </div>
              {(msg.metadata?.inputTokens || msg.metadata?.outputTokens) && (
                <div className="flex gap-3 mt-2 text-xs text-dark-500">
                  {msg.metadata.inputTokens && (
                    <span>In: {formatTokens(msg.metadata.inputTokens)}</span>
                  )}
                  {msg.metadata.outputTokens && (
                    <span>Out: {formatTokens(msg.metadata.outputTokens)}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Stats sidebar */}
        <div className="space-y-4">
          <div className="rounded-xl border border-dark-700 bg-dark-800 p-4 space-y-4">
            <h3 className="text-sm font-medium text-white">Session Stats</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <MessageSquare size={16} className="text-dark-400" />
                <div>
                  <p className="text-xs text-dark-400">Messages</p>
                  <p className="text-sm font-medium text-white">{session.stats.messageCount}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Hash size={16} className="text-dark-400" />
                <div>
                  <p className="text-xs text-dark-400">Total Tokens</p>
                  <p className="text-sm font-medium text-white">
                    {formatTokens(session.stats.totalInputTokens + session.stats.totalOutputTokens)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Coins size={16} className="text-dark-400" />
                <div>
                  <p className="text-xs text-dark-400">Cost</p>
                  <p className="text-sm font-medium text-white">
                    {formatCost(session.stats.totalCostUsd)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock size={16} className="text-dark-400" />
                <div>
                  <p className="text-xs text-dark-400">Duration</p>
                  <p className="text-sm font-medium text-white">
                    {Math.round(session.stats.duration / 1000)}s
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-dark-700 bg-dark-800 p-4 space-y-3">
            <h3 className="text-sm font-medium text-white">Details</h3>
            <div className="space-y-2 text-sm">
              <div>
                <p className="text-xs text-dark-400">Channel</p>
                <p className="text-dark-200">{session.channelType}</p>
              </div>
              <div>
                <p className="text-xs text-dark-400">Created</p>
                <p className="text-dark-200">{formatDate(session.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs text-dark-400">Last Active</p>
                <p className="text-dark-200">{formatDate(session.updatedAt)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

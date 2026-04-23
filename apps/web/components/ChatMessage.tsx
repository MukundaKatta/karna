"use client";

import { cn } from "@/lib/utils";
import { User, Bot, ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { useState } from "react";
import type { ChatMessageUI, ToolCallUI } from "@/lib/store";
import { Badge } from "./Badge";
import { RelativeTime } from "./RelativeTime";

interface ChatMessageProps {
  message: ChatMessageUI;
  onToolApproval?: (toolCallId: string, approved: boolean) => void;
}

function ToolCallDisplay({
  toolCall,
  onApproval,
}: {
  toolCall: ToolCallUI;
  onApproval?: (toolCallId: string, approved: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2 rounded-lg border border-dark-600 bg-dark-800/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-dark-300 hover:bg-dark-700/50 transition-colors"
      >
        <Wrench size={14} />
        <span className="font-medium text-dark-200">{toolCall.toolName}</span>
        <Badge variant={toolCall.status === "completed" ? "success" : toolCall.status === "failed" ? "danger" : "warning"}>
          {toolCall.status}
        </Badge>
        {toolCall.durationMs !== undefined && (
          <span className="text-xs text-dark-500 ml-auto mr-2">
            {toolCall.durationMs}ms
          </span>
        )}
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <div>
            <p className="text-xs text-dark-500 mb-1">Arguments</p>
            <pre className="text-xs bg-dark-900 rounded p-2 overflow-x-auto text-dark-300">
              {JSON.stringify(toolCall.arguments, null, 2)}
            </pre>
          </div>
          {toolCall.result !== undefined && (
            <div>
              <p className="text-xs text-dark-500 mb-1">Result</p>
              <pre className="text-xs bg-dark-900 rounded p-2 overflow-x-auto text-dark-300">
                {typeof toolCall.result === "string"
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.error && (
            <div>
              <p className="text-xs text-danger-400 mb-1">Error</p>
              <pre className="text-xs bg-dark-900 rounded p-2 overflow-x-auto text-danger-400">
                {toolCall.error}
              </pre>
            </div>
          )}
          {toolCall.status === "pending" && onApproval && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onApproval(toolCall.id, true)}
                className="px-3 py-1 text-xs font-medium rounded bg-success-500 text-white hover:bg-success-400 transition-colors"
              >
                Approve
              </button>
              <button
                onClick={() => onApproval(toolCall.id, false)}
                className="px-3 py-1 text-xs font-medium rounded bg-danger-500 text-white hover:bg-danger-400 transition-colors"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatMessage({ message, onToolApproval }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isTool = message.role === "tool";

  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-3",
        isUser && "flex-row-reverse",
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex items-center justify-center w-8 h-8 rounded-full shrink-0",
          isUser ? "bg-accent-600" : "bg-dark-600",
        )}
      >
        {isUser ? <User size={16} /> : <Bot size={16} />}
      </div>

      {/* Content */}
      <div
        className={cn(
          "flex flex-col max-w-[75%] min-w-0",
          isUser && "items-end",
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-accent-600 text-white rounded-tr-sm"
              : isSystem
                ? "bg-dark-700/50 text-dark-300 italic"
                : isTool
                  ? "bg-dark-700/50 text-dark-200 font-mono text-xs"
                  : "bg-dark-700 text-dark-100 rounded-tl-sm",
            message.isStreaming && "animate-pulse",
          )}
        >
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        </div>

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="w-full mt-1 space-y-1">
            {message.toolCalls.map((tc) => (
              <ToolCallDisplay
                key={tc.id}
                toolCall={tc}
                onApproval={onToolApproval}
              />
            ))}
          </div>
        )}

        {/* Timestamp */}
        <span className="text-xs text-dark-500 mt-1 px-1">
          <RelativeTime timestamp={message.timestamp} />
          {message.metadata?.model && (
            <span className="ml-2 text-dark-600">{message.metadata.model}</span>
          )}
        </span>
      </div>
    </div>
  );
}

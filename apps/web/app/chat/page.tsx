"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Send, Mic, Paperclip, Loader2, Wifi, WifiOff } from "lucide-react";
import {
  mapGatewayTranscriptMessage,
  mergeAssistantResponse,
  type GatewayTranscriptMessage,
} from "@/lib/chat";
import { cn } from "@/lib/utils";
import { useChatStore, type ChatMessageUI, type ToolCallUI } from "@/lib/store";
import { getWSClient } from "@/lib/ws";
import { ChatMessage } from "@/components/ChatMessage";
import { Badge } from "@/components/Badge";
import { VoiceOverlay } from "@/components/VoiceOverlay";

export default function ChatPage() {
  const {
    messages,
    activeSessionId,
    agentState,
    wsState,
    streamingContent,
    addMessage,
    updateMessage,
    appendStreamDelta,
    resetStream,
    setMessages,
    setActiveSession,
    setAgentState,
    setWSState,
    upsertSession,
  } = useChatStore();

  const [input, setInput] = useState("");
  const [voiceMode, setVoiceMode] = useState(false);
  const [wsConfigError, setWsConfigError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamMessageIdRef = useRef<string | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Connect WebSocket
  useEffect(() => {
    const ws = getWSClient();
    setWsConfigError(ws.currentConfigurationError);
    const unsubState = ws.onStateChange((state) => setWSState(state));
    const unsubMsg = ws.onMessage((data) => {
      const msg = data as Record<string, unknown>;
      const type = msg.type as string;
      const payload = msg.payload as Record<string, unknown>;

      switch (type) {
        case "connect.ack":
          if (typeof payload.sessionId === "string") {
            const sessionId = payload.sessionId;
            upsertSession({
              id: sessionId,
              title: "Web chat",
              channelType: "web",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              messageCount: useChatStore
                .getState()
                .messages.filter((message) => message.role !== "system").length,
            });
            setActiveSession(sessionId);
          }
          break;

        case "agent.response": {
          const id = (msg.id as string) ?? `msg-${Date.now()}`;
          const chatMsg: ChatMessageUI = {
            id,
            role: "assistant",
            content: payload.content as string,
            timestamp: (msg.timestamp as number) ?? Date.now(),
            metadata: {
              finishReason: payload.finishReason as string,
              ...(payload.usage as Record<string, number> | undefined),
            },
          };
          setMessages(
            mergeAssistantResponse(
              useChatStore.getState().messages,
              chatMsg,
              streamMessageIdRef.current,
            ),
          );
          streamMessageIdRef.current = null;
          resetStream();
          setAgentState("idle");
          break;
        }

        case "agent.response.stream": {
          const delta = payload.delta as string;
          if (!streamMessageIdRef.current) {
            const id = `stream-${Date.now()}`;
            streamMessageIdRef.current = id;
            resetStream();
            addMessage({
              id,
              role: "assistant",
              content: "",
              timestamp: Date.now(),
              isStreaming: true,
            });
          }
          appendStreamDelta(delta);
          const currentContent = useChatStore.getState().streamingContent;
          updateMessage(streamMessageIdRef.current, {
            content: currentContent,
          });

          if (payload.finishReason) {
            updateMessage(streamMessageIdRef.current, { isStreaming: false });
            streamMessageIdRef.current = null;
            resetStream();
            setAgentState("idle");
          }
          break;
        }

        case "tool.approval.requested": {
          const toolCall: ToolCallUI = {
            id: payload.toolCallId as string,
            toolName: payload.toolName as string,
            arguments: payload.arguments as Record<string, unknown>,
            status: "pending",
          };
          // Attach tool call to last assistant message or create new one
          const msgs = useChatStore.getState().messages;
          const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
          if (lastAssistant) {
            updateMessage(lastAssistant.id, {
              toolCalls: [...(lastAssistant.toolCalls ?? []), toolCall],
            });
          }
          setAgentState("tool_calling");
          break;
        }

        case "tool.result": {
          const msgs2 = useChatStore.getState().messages;
          for (const m of msgs2) {
            const tc = m.toolCalls?.find((t) => t.id === payload.toolCallId);
            if (tc) {
              useChatStore.getState().updateToolCall(m.id, tc.id, {
                status: (payload.isError as boolean) ? "failed" : "completed",
                result: payload.result,
                durationMs: payload.durationMs as number | undefined,
              });
              break;
            }
          }
          break;
        }

        case "status": {
          const state = payload.state as "idle" | "thinking" | "tool_calling" | "streaming" | "error";
          setAgentState(state);
          break;
        }

        case "error": {
          if (streamMessageIdRef.current) {
            updateMessage(streamMessageIdRef.current, { isStreaming: false });
            streamMessageIdRef.current = null;
            resetStream();
          }
          addMessage({
            id: `err-${Date.now()}`,
            role: "system",
            content: `Error: ${payload.message as string}`,
            timestamp: Date.now(),
          });
          setAgentState("error");
          break;
        }
      }
    });

    ws.connect();

    return () => {
      unsubState();
      unsubMsg();
    };
  }, [
    addMessage,
    appendStreamDelta,
    resetStream,
    setActiveSession,
    setAgentState,
    setMessages,
    setWSState,
    updateMessage,
    upsertSession,
  ]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    const abortController = new AbortController();

    const loadTranscript = async () => {
      try {
        const response = await fetch(`/api/sessions/${activeSessionId}/history?limit=200`, {
          cache: "no-store",
          signal: abortController.signal,
        });

        if (!response.ok && response.status !== 404) {
          return;
        }

        const payload = response.ok
          ? ((await response.json()) as {
              messages?: GatewayTranscriptMessage[];
            })
          : { messages: [] };

        if (abortController.signal.aborted) {
          return;
        }

        setMessages((payload.messages ?? []).map(mapGatewayTranscriptMessage));
        streamMessageIdRef.current = null;
        resetStream();
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
      }
    };

    void loadTranscript();

    return () => {
      abortController.abort();
    };
  }, [activeSessionId, resetStream, setMessages]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = () => {
    const content = input.trim();
    if (!content || agentState === "thinking" || agentState === "streaming") return;
    // Guard: if the gateway isn't connected we'd otherwise leave the user
    // stuck on an optimistic "Thinking..." state forever with no indication
    // of why nothing is happening.
    if (wsState !== "connected") return;

    const msg: ChatMessageUI = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      timestamp: Date.now(),
    };
    addMessage(msg);
    setInput("");
    setAgentState("thinking");

    const ws = getWSClient();
    if (activeSessionId && ws.currentSessionId !== activeSessionId) {
      ws.selectSession(activeSessionId);
    }
    ws.sendMessage(content);

    // Auto-resize textarea
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  };

  const handleToolApproval = (toolCallId: string, approved: boolean) => {
    const ws = getWSClient();
    ws.sendToolApproval(toolCallId, approved);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header — offset left on mobile for hamburger menu */}
      <div className="flex items-center justify-between px-5 pl-14 md:pl-5 h-14 border-b border-dark-700 shrink-0">
        <h1 className="text-base font-semibold text-white">Chat</h1>
        <div className="flex items-center gap-1.5 sm:gap-2">
          {agentState !== "idle" && agentState !== "error" && (
            <Badge variant="accent">
              <Loader2 size={12} className="animate-spin mr-1" />
              {agentState === "thinking"
                ? "Thinking..."
                : agentState === "streaming"
                  ? "Responding..."
                  : agentState === "tool_calling"
                    ? "Using tool..."
                    : agentState}
            </Badge>
          )}
          <Badge variant={wsState === "connected" ? "success" : "danger"}>
            {wsState === "connected" ? (
              <Wifi size={12} className="mr-1" />
            ) : (
              <WifiOff size={12} className="mr-1" />
            )}
            {wsState}
          </Badge>
        </div>
      </div>

      {/* Disconnected banner — surface why sends may be silently dropped */}
      {wsState !== "connected" && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/30 px-4 py-2 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
          <span className="text-yellow-400 text-sm font-medium">
            {wsState === "connecting"
              ? "Connecting to gateway\u2026"
              : wsConfigError
                ? "Gateway configuration is incomplete"
                : "Gateway not connected"}
          </span>
          <span className="text-yellow-400/70 text-xs sm:text-sm">
            {wsConfigError ? (
              <>
                {wsConfigError}. Set{" "}
                <code className="bg-dark-700 px-1.5 py-0.5 rounded text-xs">NEXT_PUBLIC_GATEWAY_URL</code>
                {" "}or{" "}
                <code className="bg-dark-700 px-1.5 py-0.5 rounded text-xs">NEXT_PUBLIC_WS_URL</code>
                .
              </>
            ) : (
              <>
                Start it locally with{" "}
                <code className="bg-dark-700 px-1.5 py-0.5 rounded text-xs">pnpm gateway:dev</code>
                {" "}or set{" "}
                <code className="bg-dark-700 px-1.5 py-0.5 rounded text-xs">NEXT_PUBLIC_GATEWAY_URL</code>
                .
              </>
            )}
          </span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-dark-500">
            <MessageSquareIcon />
            <p className="mt-3 text-lg font-medium text-dark-300">Start a conversation</p>
            <p className="text-sm mt-1">Send a message to begin chatting with Karna</p>
          </div>
        ) : (
          <div className="py-4">
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                onToolApproval={handleToolApproval}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Voice overlay */}
      <VoiceOverlay
        open={voiceMode}
        onClose={() => setVoiceMode(false)}
        onTranscript={(text) => {
          // Show the transcribed text as a user message in the chat
          addMessage({
            id: `voice-${Date.now()}`,
            role: "user",
            content: text,
            timestamp: Date.now(),
            metadata: { finishReason: "voice" },
          });
        }}
      />

      {/* Input area — safe area padding for notched phones */}
      <div className="border-t border-dark-700 px-3 sm:px-4 py-2 sm:py-3 pb-safe">
        <div className="flex items-end gap-1.5 sm:gap-2 max-w-4xl mx-auto">
          <button
            className="p-2 sm:p-2.5 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700 transition-colors shrink-0 hidden sm:flex"
            title="Attach file"
          >
            <Paperclip size={18} />
          </button>
          <div className="flex-1 relative min-w-0">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              rows={1}
              className="w-full px-3 sm:px-4 py-2.5 bg-dark-700 border border-dark-600 rounded-xl text-sm text-dark-100 placeholder:text-dark-500 focus:outline-none focus:border-accent-500 resize-none"
              style={{ maxHeight: "120px" }}
            />
          </div>
          <button
            onClick={() => setVoiceMode(true)}
            className="p-2 sm:p-2.5 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700 transition-colors shrink-0 hidden sm:flex"
            title="Voice input"
          >
            <Mic size={18} />
          </button>
          <button
            onClick={handleSend}
            disabled={
              !input.trim() ||
              agentState === "thinking" ||
              agentState === "streaming" ||
              wsState !== "connected"
            }
            className={cn(
              "p-2.5 rounded-lg transition-colors shrink-0",
              input.trim() &&
                agentState !== "thinking" &&
                agentState !== "streaming" &&
                wsState === "connected"
                ? "bg-accent-600 text-white hover:bg-accent-500 active:scale-95"
                : "bg-dark-700 text-dark-500 cursor-not-allowed",
            )}
            title={wsState === "connected" ? "Send message" : "Gateway not connected"}
          >
            {agentState === "thinking" || agentState === "streaming" ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageSquareIcon() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

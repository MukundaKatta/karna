// ─── Voice Message Handler ──────────────────────────────────────────────────
//
// Handles voice session lifecycle: accumulates audio chunks, runs STT,
// forwards transcribed text to the agent, and returns TTS audio.
//
// ─────────────────────────────────────────────────────────────────────────────

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { WebSocket } from "@fastify/websocket";
import { nanoid } from "nanoid";
import pino from "pino";
import { VoiceProcessor } from "@karna/agent/voice/index.js";
import type { ConnectionContext } from "../protocol/handler.js";

const logger = pino({ name: "voice-handler" });

// ─── Types ──────────────────────────────────────────────────────────────────

interface VoiceSession {
  /** Audio chunks accumulated during recording. */
  chunks: Buffer[];
  /** Audio format reported by the client. */
  format: "webm" | "wav" | "m4a";
  /** Sample rate reported by the client. */
  sampleRate: number;
  /** Voice mode: push-to-talk or continuous. */
  mode: "push-to-talk" | "continuous";
  /** Timestamp when the session started. */
  startedAt: number;
}

// ─── State ──────────────────────────────────────────────────────────────────

/** Per-WebSocket voice sessions, keyed by the ws instance. */
const voiceSessions = new WeakMap<WebSocket, VoiceSession>();

/** Shared VoiceProcessor singleton. */
let voiceProcessor: VoiceProcessor | null = null;

function getVoiceProcessor(): VoiceProcessor {
  if (!voiceProcessor) {
    voiceProcessor = new VoiceProcessor({
      defaultAudioFormat: "webm",
    });
  }
  return voiceProcessor;
}

// ─── Agent Config Defaults ─────────────────────────────────────────────────

const DEFAULT_AGENT_NAME = "Karna";
const DEFAULT_AGENT_DESCRIPTION = "A loyal and capable AI assistant.";
const DEFAULT_AGENT_PERSONALITY = "Helpful, accurate, and concise.";
const DEFAULT_AGENT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_AGENT_PROVIDER = "anthropic";

interface VoiceAgentConfig {
  name: string;
  description: string;
  personality: string;
  defaultModel: string;
  defaultProvider: string;
}

let cachedAgentConfig: VoiceAgentConfig | null = null;

async function loadAgentConfig(): Promise<VoiceAgentConfig> {
  if (cachedAgentConfig) return cachedAgentConfig;

  try {
    const configPath = resolve(import.meta.dirname, "../../../../config/default.json");
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const agent = parsed["agent"] as Record<string, unknown> | undefined;
    const models = agent?.["models"] as Record<string, unknown> | undefined;
    const primary = models?.["primary"] as Record<string, unknown> | undefined;

    cachedAgentConfig = {
      name: (agent?.["name"] as string) ?? DEFAULT_AGENT_NAME,
      description: DEFAULT_AGENT_DESCRIPTION,
      personality: (agent?.["persona"] as string) ?? DEFAULT_AGENT_PERSONALITY,
      defaultModel: (primary?.["model"] as string) ?? DEFAULT_AGENT_MODEL,
      defaultProvider: (primary?.["provider"] as string) ?? DEFAULT_AGENT_PROVIDER,
    };
  } catch {
    logger.warn("Failed to load agent config from default.json, using built-in defaults");
    cachedAgentConfig = {
      name: DEFAULT_AGENT_NAME,
      description: DEFAULT_AGENT_DESCRIPTION,
      personality: DEFAULT_AGENT_PERSONALITY,
      defaultModel: DEFAULT_AGENT_MODEL,
      defaultProvider: DEFAULT_AGENT_PROVIDER,
    };
  }

  return cachedAgentConfig;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sendMessage(ws: WebSocket, message: Record<string, unknown>): void {
  try {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  } catch (error) {
    logger.error({ error: String(error) }, "Failed to send voice message");
  }
}

function sendError(ws: WebSocket, code: string, message: string, sessionId?: string): void {
  sendMessage(ws, {
    id: nanoid(),
    type: "error",
    timestamp: Date.now(),
    sessionId,
    payload: { code, message, retryable: false },
  });
}

// ─── Voice Start ────────────────────────────────────────────────────────────

export function handleVoiceStart(
  ws: WebSocket,
  payload: { mode: "push-to-talk" | "continuous" },
  _context: ConnectionContext,
): void {
  logger.info({ mode: payload.mode }, "Voice session started");

  voiceSessions.set(ws, {
    chunks: [],
    format: "webm",
    sampleRate: 48000,
    mode: payload.mode,
    startedAt: Date.now(),
  });

  // Acknowledge the voice session start
  sendMessage(ws, {
    id: nanoid(),
    type: "status",
    timestamp: Date.now(),
    payload: {
      state: "idle",
      message: "Voice session active",
    },
  });
}

// ─── Voice Audio Chunk ──────────────────────────────────────────────────────

export function handleVoiceAudioChunk(
  ws: WebSocket,
  payload: { data: string; format: "webm" | "wav" | "m4a"; sampleRate: number },
  _context: ConnectionContext,
): void {
  const session = voiceSessions.get(ws);

  if (!session) {
    sendError(ws, "VOICE_NO_SESSION", "No active voice session. Send voice.start first.");
    return;
  }

  try {
    const audioData = Buffer.from(payload.data, "base64");
    session.chunks.push(audioData);
    session.format = payload.format;
    session.sampleRate = payload.sampleRate;

    logger.debug(
      {
        chunkSize: audioData.length,
        totalChunks: session.chunks.length,
        format: payload.format,
      },
      "Voice audio chunk received",
    );
  } catch (error) {
    logger.error({ error: String(error) }, "Failed to process audio chunk");
    sendError(ws, "VOICE_CHUNK_ERROR", "Failed to process audio chunk");
  }
}

// ─── Voice End ──────────────────────────────────────────────────────────────

export async function handleVoiceEnd(
  ws: WebSocket,
  _payload: Record<string, unknown> | undefined,
  context: ConnectionContext,
): Promise<void> {
  const session = voiceSessions.get(ws);

  if (!session) {
    sendError(ws, "VOICE_NO_SESSION", "No active voice session to end.");
    return;
  }

  // Remove the session immediately so no more chunks are accepted
  voiceSessions.delete(ws);

  if (session.chunks.length === 0) {
    sendError(ws, "VOICE_EMPTY", "No audio data received during voice session.");
    return;
  }

  // Try to find a sessionId from the context's connected clients
  let resolvedSessionId: string | undefined;
  for (const [, client] of context.connectedClients) {
    if (client.ws === ws && client.sessionIds.size > 0) {
      resolvedSessionId = [...client.sessionIds][0];
      break;
    }
  }

  logger.info(
    {
      chunkCount: session.chunks.length,
      format: session.format,
      durationMs: Date.now() - session.startedAt,
    },
    "Voice session ended, processing audio",
  );

  // Send "thinking" status
  sendMessage(ws, {
    id: nanoid(),
    type: "status",
    timestamp: Date.now(),
    sessionId: resolvedSessionId,
    payload: {
      state: "thinking",
      message: "Transcribing audio...",
    },
  });

  try {
    const processor = getVoiceProcessor();

    // 1. Concatenate all audio chunks
    const audioBuffer = Buffer.concat(session.chunks);

    // 2. STT: audio -> text
    const transcribedText = await processor.processVoiceMessage(
      audioBuffer,
      session.format,
    );

    if (!transcribedText.trim()) {
      sendMessage(ws, {
        id: nanoid(),
        type: "voice.transcript",
        timestamp: Date.now(),
        sessionId: resolvedSessionId,
        payload: { text: "", isFinal: true },
      });
      sendMessage(ws, {
        id: nanoid(),
        type: "status",
        timestamp: Date.now(),
        sessionId: resolvedSessionId,
        payload: { state: "idle" },
      });
      return;
    }

    // 3. Send transcript to client
    sendMessage(ws, {
      id: nanoid(),
      type: "voice.transcript",
      timestamp: Date.now(),
      sessionId: resolvedSessionId,
      payload: { text: transcribedText, isFinal: true },
    });

    // 4. Forward transcribed text as a chat message to the agent
    //    We import handleMessage dynamically to avoid circular deps — instead
    //    we replicate the chat send logic inline for voice.
    sendMessage(ws, {
      id: nanoid(),
      type: "status",
      timestamp: Date.now(),
      sessionId: resolvedSessionId,
      payload: {
        state: "thinking",
        message: "Processing your message...",
      },
    });

    // Import agent runtime utilities from the handler module
    const { AgentRuntime } = await import("@karna/agent/runtime.js");
    const { ToolRegistry } = await import("@karna/agent/tools/registry.js");
    const { registerBuiltinTools } = await import("@karna/agent/tools/builtin/index.js");
    const { appendToTranscript, readTranscript } = await import("../session/store.js");

    // Get or create agent runtime
    const toolRegistry = new ToolRegistry();
    registerBuiltinTools(toolRegistry);
    const runtime = new AgentRuntime(toolRegistry, undefined, undefined, {
      maxToolIterations: 10,
      maxHistoryMessages: 50,
      autoMemory: false,
    });
    await runtime.init();

    // Find session from manager
    const chatSession = resolvedSessionId
      ? context.sessionManager.getSession(resolvedSessionId)
      : null;

    if (!chatSession || !resolvedSessionId) {
      sendError(ws, "SESSION_NOT_FOUND", "No chat session found for voice processing");
      return;
    }

    // Persist user voice message to transcript
    await appendToTranscript(resolvedSessionId, {
      id: nanoid(),
      sessionId: resolvedSessionId,
      role: "user",
      content: transcribedText,
      timestamp: Date.now(),
      metadata: { finishReason: "voice" },
    });

    // Load conversation history
    const history = await readTranscript(resolvedSessionId, 50);

    // Load agent config from config/default.json (or use defaults)
    const agentConfig = await loadAgentConfig();

    // Execute agent turn
    const result = await runtime.run({
      message: transcribedText,
      session: chatSession,
      agent: {
        id: chatSession.channelId,
        name: agentConfig.name,
        description: agentConfig.description,
        personality: agentConfig.personality,
        defaultModel: agentConfig.defaultModel,
        defaultProvider: agentConfig.defaultProvider,
      },
      conversationHistory: history,
    });

    if (!result.success) {
      sendError(ws, "AGENT_ERROR", result.error ?? "Agent processing failed");
      return;
    }

    const agentResponse = result.response;

    // Persist assistant message
    await appendToTranscript(resolvedSessionId, {
      id: nanoid(),
      sessionId: resolvedSessionId,
      role: "assistant",
      content: agentResponse,
      timestamp: Date.now(),
      metadata: {
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        finishReason: "voice",
      },
    });

    // Send agent text response
    sendMessage(ws, {
      id: nanoid(),
      type: "agent.response",
      timestamp: Date.now(),
      sessionId: resolvedSessionId,
      payload: {
        content: agentResponse,
        role: "assistant",
        finishReason: "stop",
        usage: result.usage,
      },
    });

    // 5. TTS: text -> audio
    sendMessage(ws, {
      id: nanoid(),
      type: "status",
      timestamp: Date.now(),
      sessionId: resolvedSessionId,
      payload: {
        state: "streaming",
        message: "Generating voice response...",
      },
    });

    const audioResponse = await processor.generateVoiceResponse(agentResponse);
    const audioBase64 = audioResponse.toString("base64");

    // 6. Send audio response to client
    sendMessage(ws, {
      id: nanoid(),
      type: "voice.audio.response",
      timestamp: Date.now(),
      sessionId: resolvedSessionId,
      payload: {
        data: audioBase64,
        format: "mp3",
        transcript: agentResponse,
      },
    });

    // Update session stats
    context.sessionManager.updateSessionStats(
      resolvedSessionId,
      result.usage.inputTokens,
      result.usage.outputTokens,
      0,
    );

    logger.info(
      {
        sessionId: resolvedSessionId,
        transcribedLength: transcribedText.length,
        responseLength: agentResponse.length,
        audioResponseSize: audioResponse.length,
      },
      "Voice pipeline completed",
    );
  } catch (error) {
    logger.error({ error: String(error) }, "Voice processing failed");
    sendError(ws, "VOICE_PROCESSING_ERROR", `Voice processing failed: ${String(error)}`);
  } finally {
    // Always return to idle
    sendMessage(ws, {
      id: nanoid(),
      type: "status",
      timestamp: Date.now(),
      payload: { state: "idle" },
    });
  }
}

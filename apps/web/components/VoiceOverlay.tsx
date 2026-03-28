"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X, Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { getVoiceClient, type VoiceState } from "@/lib/voice";
import { getWSClient } from "@/lib/ws";

interface VoiceOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Called when a voice message is transcribed and sent to the agent. */
  onTranscript?: (text: string) => void;
}

export function VoiceOverlay({ open, onClose, onTranscript }: VoiceOverlayProps) {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [statusText, setStatusText] = useState("Tap the microphone to start");
  const voiceClientRef = useRef(getVoiceClient());

  // Subscribe to voice client events
  useEffect(() => {
    if (!open) return;

    const vc = voiceClientRef.current;
    const unsubState = vc.onStateChange((state) => {
      setVoiceState(state);
      switch (state) {
        case "recording":
          setStatusText("Listening...");
          break;
        case "processing":
          setStatusText("Thinking...");
          break;
        case "playing":
          setStatusText("Speaking...");
          break;
        case "error":
          setStatusText("Something went wrong. Tap to retry.");
          break;
        default:
          setStatusText("Tap the microphone to start");
      }
    });

    const unsubLevel = vc.onAudioLevel((level) => {
      setAudioLevel(level);
    });

    const unsubTranscript = vc.onTranscript((text, isFinal) => {
      setTranscript(text);
      if (isFinal && text.trim()) {
        onTranscript?.(text);
      }
    });

    return () => {
      unsubState();
      unsubLevel();
      unsubTranscript();
    };
  }, [open, onTranscript]);

  // Listen for voice.transcript and voice.audio.response messages from WS
  useEffect(() => {
    if (!open) return;

    const ws = getWSClient();
    const vc = voiceClientRef.current;

    const unsubMsg = ws.onMessage((data) => {
      const msg = data as Record<string, unknown>;
      const type = msg.type as string;
      const payload = msg.payload as Record<string, unknown>;

      if (type === "voice.transcript") {
        const text = payload.text as string;
        const isFinal = payload.isFinal as boolean;
        setTranscript(text);
        vc.handleTranscript(text, isFinal);
      }

      if (type === "voice.audio.response") {
        const audioData = payload.data as string;
        const format = payload.format as string;
        const responseTranscript = payload.transcript as string;
        setTranscript(responseTranscript);
        vc.playAudio(audioData, format);
      }
    });

    return () => {
      unsubMsg();
    };
  }, [open]);

  // Cleanup on close
  useEffect(() => {
    if (!open) {
      const vc = voiceClientRef.current;
      if (vc.isRecording) {
        vc.stopRecording();
      }
      setTranscript("");
      setAudioLevel(0);
      setVoiceState("idle");
    }
  }, [open]);

  const handleMicClick = useCallback(() => {
    const vc = voiceClientRef.current;
    if (vc.isRecording) {
      vc.stopRecording();
    } else {
      setTranscript("");
      vc.startRecording();
    }
  }, []);

  const handleClose = useCallback(() => {
    const vc = voiceClientRef.current;
    if (vc.isRecording) {
      vc.stopRecording();
    }
    onClose();
  }, [onClose]);

  // Handle Escape key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, handleClose]);

  if (!open) return null;

  const isRecording = voiceState === "recording";
  const isProcessing = voiceState === "processing";
  const isPlaying = voiceState === "playing";
  const isActive = isRecording || isProcessing || isPlaying;

  // Generate visualization bars based on audio level
  const barCount = 24;
  const bars = Array.from({ length: barCount }, (_, i) => {
    const position = i / barCount;
    const centerDistance = Math.abs(position - 0.5) * 2;
    const baseHeight = isRecording
      ? Math.max(0.1, (1 - centerDistance) * audioLevel * 2.5)
      : isPlaying
        ? Math.max(0.1, (1 - centerDistance) * 0.4 + Math.sin(Date.now() / 200 + i) * 0.15)
        : 0.1;
    return Math.min(1, baseHeight);
  });

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-dark-900/95 backdrop-blur-sm">
      {/* Close button */}
      <button
        onClick={handleClose}
        className="absolute top-4 right-4 p-2 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700 transition-colors"
        title="Close voice mode"
      >
        <X size={24} />
      </button>

      {/* Status text */}
      <p className="text-dark-300 text-sm font-medium mb-8 tracking-wide uppercase">
        {statusText}
      </p>

      {/* Audio visualization bars */}
      <div className="flex items-center gap-1 h-20 mb-8">
        {bars.map((height, i) => (
          <div
            key={i}
            className={cn(
              "w-1 rounded-full transition-all duration-100",
              isRecording
                ? "bg-accent-500"
                : isPlaying
                  ? "bg-green-500"
                  : isProcessing
                    ? "bg-amber-500"
                    : "bg-dark-600",
            )}
            style={{
              height: `${Math.max(4, height * 80)}px`,
              transition: isRecording ? "height 100ms ease-out" : "height 300ms ease-out",
            }}
          />
        ))}
      </div>

      {/* Microphone button */}
      <button
        onClick={handleMicClick}
        disabled={isProcessing || isPlaying}
        className={cn(
          "relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200",
          isRecording
            ? "bg-red-600 hover:bg-red-500 text-white scale-110"
            : isProcessing || isPlaying
              ? "bg-dark-700 text-dark-400 cursor-not-allowed"
              : "bg-accent-600 hover:bg-accent-500 text-white hover:scale-105 active:scale-95",
        )}
      >
        {/* Pulsing ring when recording */}
        {isRecording && (
          <>
            <span className="absolute inset-0 rounded-full bg-red-600 animate-ping opacity-20" />
            <span className="absolute inset-[-4px] rounded-full border-2 border-red-500 animate-pulse opacity-40" />
          </>
        )}

        {/* Processing spinner */}
        {isProcessing && (
          <span className="absolute inset-[-4px] rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
        )}

        {isRecording ? (
          <MicOff size={32} />
        ) : (
          <Mic size={32} />
        )}
      </button>

      {/* Transcript display */}
      <div className="mt-10 px-8 max-w-lg text-center min-h-[3rem]">
        {transcript ? (
          <p className={cn(
            "text-base leading-relaxed",
            isActive ? "text-dark-200" : "text-dark-300",
          )}>
            {transcript}
          </p>
        ) : (
          <p className="text-dark-600 text-sm">
            {isRecording ? "Speak now..." : ""}
          </p>
        )}
      </div>

      {/* Keyboard hint */}
      <p className="absolute bottom-6 text-dark-600 text-xs">
        Press <kbd className="px-1.5 py-0.5 rounded bg-dark-700 text-dark-400 text-xs font-mono">Esc</kbd> to close
      </p>
    </div>
  );
}

// ─── Voice Client ───────────────────────────────────────────────────────────
//
// Browser-side voice utilities: microphone capture via MediaRecorder,
// WebSocket audio streaming, and audio playback via Web Audio API.
//
// ─────────────────────────────────────────────────────────────────────────────

import { getWSClient } from "./ws";

export type VoiceState = "idle" | "requesting" | "recording" | "processing" | "playing" | "error";
export type VoiceStateHandler = (state: VoiceState) => void;
export type AudioLevelHandler = (level: number) => void;
export type TranscriptHandler = (text: string, isFinal: boolean) => void;

export class VoiceClient {
  private mediaRecorder: MediaRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animationFrame: number | null = null;
  private _state: VoiceState = "idle";
  private stateHandlers = new Set<VoiceStateHandler>();
  private levelHandlers = new Set<AudioLevelHandler>();
  private transcriptHandlers = new Set<TranscriptHandler>();

  get state(): VoiceState {
    return this._state;
  }

  get isRecording(): boolean {
    return this._state === "recording";
  }

  // ─── Event Subscriptions ──────────────────────────────────────────────────

  onStateChange(handler: VoiceStateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  onAudioLevel(handler: AudioLevelHandler): () => void {
    this.levelHandlers.add(handler);
    return () => this.levelHandlers.delete(handler);
  }

  onTranscript(handler: TranscriptHandler): () => void {
    this.transcriptHandlers.add(handler);
    return () => this.transcriptHandlers.delete(handler);
  }

  // ─── Recording ────────────────────────────────────────────────────────────

  async startRecording(): Promise<void> {
    if (this._state === "recording") return;

    this.setState("requesting");

    try {
      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
        },
      });

      // Set up audio level analysis
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
      this.startLevelMonitoring();

      // Set up MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      this.mediaRecorder = new MediaRecorder(this.mediaStream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });

      // Send voice.start to gateway
      const ws = getWSClient();
      ws.send({
        id: crypto.randomUUID(),
        type: "voice.start",
        timestamp: Date.now(),
        sessionId: ws.currentSessionId,
        payload: { mode: "push-to-talk" },
      });

      // Send audio chunks as they become available
      this.mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          const buffer = await event.data.arrayBuffer();
          const base64 = btoa(
            String.fromCharCode(...new Uint8Array(buffer)),
          );

          ws.send({
            id: crypto.randomUUID(),
            type: "voice.audio.chunk",
            timestamp: Date.now(),
            sessionId: ws.currentSessionId,
            payload: {
              data: base64,
              format: "webm",
              sampleRate: 48000,
            },
          });
        }
      };

      this.mediaRecorder.onstop = () => {
        // Send voice.end to gateway
        ws.send({
          id: crypto.randomUUID(),
          type: "voice.end",
          timestamp: Date.now(),
          sessionId: ws.currentSessionId,
          payload: {},
        });
      };

      // Start recording with 250ms timeslice for chunked streaming
      this.mediaRecorder.start(250);
      this.setState("recording");
    } catch (error) {
      console.error("Failed to start recording:", error);
      this.setState("error");
      this.cleanup();
    }
  }

  stopRecording(): void {
    if (this._state !== "recording" || !this.mediaRecorder) return;

    this.setState("processing");
    this.mediaRecorder.stop();
    this.stopLevelMonitoring();

    // Stop all tracks on the media stream
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  // ─── Audio Playback ───────────────────────────────────────────────────────

  async playAudio(base64Data: string, format: string = "mp3"): Promise<void> {
    this.setState("playing");

    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }

      // Resume audio context if it's suspended (browser autoplay policy)
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      // Decode base64 to ArrayBuffer
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Decode audio data
      const audioBuffer = await this.audioContext.decodeAudioData(bytes.buffer);

      // Play it
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);

      source.onended = () => {
        this.setState("idle");
      };

      source.start(0);
    } catch (error) {
      console.error("Failed to play audio:", error);
      this.setState("idle");
    }
  }

  // ─── Transcript Handling ──────────────────────────────────────────────────

  handleTranscript(text: string, isFinal: boolean): void {
    this.transcriptHandlers.forEach((handler) => handler(text, isFinal));
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  destroy(): void {
    this.stopRecording();
    this.cleanup();
    this.stateHandlers.clear();
    this.levelHandlers.clear();
    this.transcriptHandlers.clear();
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private setState(state: VoiceState): void {
    this._state = state;
    this.stateHandlers.forEach((handler) => handler(state));
  }

  private startLevelMonitoring(): void {
    if (!this.analyser) return;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    const tick = () => {
      if (!this.analyser) return;

      this.analyser.getByteFrequencyData(dataArray);

      // Calculate average volume (0-1 range)
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i]!;
      }
      const average = sum / dataArray.length / 255;
      this.levelHandlers.forEach((handler) => handler(average));

      this.animationFrame = requestAnimationFrame(tick);
    };

    tick();
  }

  private stopLevelMonitoring(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  private cleanup(): void {
    this.stopLevelMonitoring();

    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      try {
        this.mediaRecorder.stop();
      } catch {
        // ignore
      }
    }
    this.mediaRecorder = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    this.analyser = null;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let voiceClientInstance: VoiceClient | null = null;

export function getVoiceClient(): VoiceClient {
  if (!voiceClientInstance) {
    voiceClientInstance = new VoiceClient();
  }
  return voiceClientInstance;
}

// ─── Text-to-Speech ─────────────────────────────────────────────────────────
//
// ElevenLabs TTS with macOS `say` fallback.
//
// ─────────────────────────────────────────────────────────────────────────────

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pino from "pino";

const execFileAsync = promisify(execFile);
const logger = pino({ name: "voice-tts" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TTSConfig {
  /** ElevenLabs API key. If absent, falls back to macOS `say`. */
  apiKey?: string;
  /** ElevenLabs base URL. */
  baseUrl?: string;
  /** Default voice ID. */
  defaultVoiceId?: string;
  /** Model ID (e.g. "eleven_multilingual_v2"). */
  model?: string;
  /** Voice stability (0-1). */
  stability?: number;
  /** Voice similarity boost (0-1). */
  similarityBoost?: number;
  /** Output audio format. */
  outputFormat?: "mp3_44100_128" | "mp3_22050_32" | "pcm_16000" | "pcm_24000";
}

export interface Voice {
  voiceId: string;
  name: string;
  category: string;
  description?: string;
  previewUrl?: string;
  labels: Record<string, string>;
}

const DEFAULT_BASE_URL = "https://api.elevenlabs.io/v1";
const DEFAULT_MODEL = "eleven_multilingual_v2";
const DEFAULT_STABILITY = 0.5;
const DEFAULT_SIMILARITY = 0.75;
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";
const MAX_CHUNK_LENGTH = 4000;

// ─── ElevenLabs TTS ─────────────────────────────────────────────────────────

export class ElevenLabsTTS {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly defaultVoiceId: string;
  private readonly model: string;
  private readonly stability: number;
  private readonly similarityBoost: number;
  private readonly outputFormat: string;

  constructor(config: TTSConfig = {}) {
    this.apiKey = config.apiKey ?? process.env["ELEVENLABS_API_KEY"];
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.defaultVoiceId = config.defaultVoiceId ?? "21m00Tcm4TlvDq8ikWAM"; // Rachel
    this.model = config.model ?? DEFAULT_MODEL;
    this.stability = config.stability ?? DEFAULT_STABILITY;
    this.similarityBoost = config.similarityBoost ?? DEFAULT_SIMILARITY;
    this.outputFormat = config.outputFormat ?? DEFAULT_OUTPUT_FORMAT;

    if (this.apiKey) {
      logger.info("ElevenLabs TTS initialized with API key");
    } else {
      logger.info("No ElevenLabs API key found, will use macOS say fallback");
    }
  }

  // ─── Synthesize ──────────────────────────────────────────────────────────

  /**
   * Synthesize text into audio. Uses ElevenLabs API if available,
   * otherwise falls back to macOS `say`.
   */
  async synthesize(text: string, voiceId?: string): Promise<Buffer> {
    if (!text.trim()) {
      throw new Error("Text must not be empty");
    }

    if (!this.apiKey) {
      return this.fallbackSay(text);
    }

    const resolvedVoiceId = voiceId ?? this.defaultVoiceId;

    // For long text, synthesize in chunks and concatenate
    if (text.length > MAX_CHUNK_LENGTH) {
      return this.synthesizeLongText(text, resolvedVoiceId);
    }

    return this.synthesizeChunk(text, resolvedVoiceId);
  }

  // ─── Stream ──────────────────────────────────────────────────────────────

  /**
   * Stream TTS audio for real-time playback.
   * Returns an async iterable of audio chunks.
   */
  async *synthesizeStream(
    text: string,
    voiceId?: string,
  ): AsyncGenerator<Buffer, void, unknown> {
    if (!this.apiKey) {
      yield await this.fallbackSay(text);
      return;
    }

    const resolvedVoiceId = voiceId ?? this.defaultVoiceId;
    const url = `${this.baseUrl}/text-to-speech/${resolvedVoiceId}/stream`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": this.apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: this.model,
        voice_settings: {
          stability: this.stability,
          similarity_boost: this.similarityBoost,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `ElevenLabs streaming TTS failed (${response.status}): ${errorBody}`,
      );
    }

    if (!response.body) {
      throw new Error("No response body for TTS stream");
    }

    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield Buffer.from(value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ─── List Voices ─────────────────────────────────────────────────────────

  /**
   * List available voices from ElevenLabs.
   */
  async listVoices(): Promise<Voice[]> {
    if (!this.apiKey) {
      logger.warn("Cannot list voices without ElevenLabs API key");
      return [];
    }

    const url = `${this.baseUrl}/voices`;

    const response = await fetch(url, {
      headers: {
        "xi-api-key": this.apiKey,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `ElevenLabs list voices failed (${response.status}): ${errorBody}`,
      );
    }

    const data = (await response.json()) as {
      voices: Array<{
        voice_id: string;
        name: string;
        category: string;
        description?: string;
        preview_url?: string;
        labels: Record<string, string>;
      }>;
    };

    return data.voices.map((v) => ({
      voiceId: v.voice_id,
      name: v.name,
      category: v.category,
      description: v.description,
      previewUrl: v.preview_url,
      labels: v.labels ?? {},
    }));
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async synthesizeChunk(text: string, voiceId: string): Promise<Buffer> {
    const url = `${this.baseUrl}/text-to-speech/${voiceId}?output_format=${this.outputFormat}`;

    logger.debug(
      { voiceId, textLength: text.length, model: this.model },
      "Synthesizing speech chunk",
    );

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": this.apiKey!,
      },
      body: JSON.stringify({
        text,
        model_id: this.model,
        voice_settings: {
          stability: this.stability,
          similarity_boost: this.similarityBoost,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `ElevenLabs TTS failed (${response.status}): ${errorBody}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async synthesizeLongText(text: string, voiceId: string): Promise<Buffer> {
    const chunks = this.splitText(text);
    logger.debug(
      { chunkCount: chunks.length, totalLength: text.length },
      "Splitting long text for TTS",
    );

    const audioBuffers: Buffer[] = [];

    for (const chunk of chunks) {
      const audioBuffer = await this.synthesizeChunk(chunk, voiceId);
      audioBuffers.push(audioBuffer);
    }

    return Buffer.concat(audioBuffers);
  }

  private splitText(text: string): string[] {
    const chunks: string[] = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    let current = "";

    for (const sentence of sentences) {
      if (current.length + sentence.length > MAX_CHUNK_LENGTH) {
        if (current.trim()) {
          chunks.push(current.trim());
        }
        current = sentence;
      } else {
        current += (current ? " " : "") + sentence;
      }
    }

    if (current.trim()) {
      chunks.push(current.trim());
    }

    return chunks;
  }

  /**
   * Fallback: use macOS `say` command to generate AIFF audio,
   * then return the buffer.
   */
  private async fallbackSay(text: string): Promise<Buffer> {
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { readFile, unlink } = await import("node:fs/promises");
    const { randomUUID } = await import("node:crypto");

    const outputPath = join(tmpdir(), `karna-tts-${randomUUID()}.aiff`);

    logger.debug({ textLength: text.length }, "Using macOS say fallback");

    try {
      await execFileAsync("say", ["-o", outputPath, text], {
        timeout: 30_000,
      });

      const audioData = await readFile(outputPath);
      return audioData;
    } catch (error) {
      throw new Error(
        `macOS say fallback failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      try {
        await unlink(outputPath);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

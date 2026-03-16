// ─── Speech-to-Text ─────────────────────────────────────────────────────────
//
// OpenAI Whisper-based STT with language detection.
//
// ─────────────────────────────────────────────────────────────────────────────

import OpenAI from "openai";
import pino from "pino";

const logger = pino({ name: "voice-stt" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface STTConfig {
  /** OpenAI API key. Defaults to OPENAI_API_KEY env var. */
  apiKey?: string;
  /** OpenAI base URL override. */
  baseUrl?: string;
  /** Whisper model to use. */
  model?: string;
  /** Default language code (e.g. "en"). If omitted, auto-detect. */
  defaultLanguage?: string;
  /** Response format for transcription. */
  responseFormat?: "json" | "verbose_json" | "text" | "srt" | "vtt";
  /** Temperature for transcription (0-1). */
  temperature?: number;
}

export interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  temperature: number;
  avgLogprob: number;
  noSpeechProb: number;
}

export interface TranscriptionResult {
  /** The full transcribed text. */
  text: string;
  /** Detected or provided language. */
  language: string;
  /** Duration of the audio in seconds. */
  duration: number;
  /** Individual segments with timestamps. */
  segments: TranscriptionSegment[];
}

export type AudioFormat = "mp3" | "wav" | "m4a" | "webm" | "mp4" | "mpeg" | "mpga" | "oga" | "ogg" | "flac";

const SUPPORTED_FORMATS: Set<AudioFormat> = new Set([
  "mp3", "wav", "m4a", "webm", "mp4", "mpeg", "mpga", "oga", "ogg", "flac",
]);

const MIME_MAP: Record<AudioFormat, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/m4a",
  webm: "audio/webm",
  mp4: "audio/mp4",
  mpeg: "audio/mpeg",
  mpga: "audio/mpeg",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

const DEFAULT_MODEL = "whisper-1";

// ─── Whisper STT ────────────────────────────────────────────────────────────

export class WhisperSTT {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly defaultLanguage: string | undefined;
  private readonly temperature: number;

  constructor(config: STTConfig = {}) {
    this.client = new OpenAI({
      apiKey: config.apiKey ?? process.env["OPENAI_API_KEY"],
      baseURL: config.baseUrl,
    });
    this.model = config.model ?? DEFAULT_MODEL;
    this.defaultLanguage = config.defaultLanguage;
    this.temperature = config.temperature ?? 0;

    logger.info({ model: this.model }, "WhisperSTT initialized");
  }

  // ─── Transcribe ──────────────────────────────────────────────────────────

  /**
   * Transcribe an audio buffer to text using OpenAI Whisper.
   *
   * @param audioBuffer - Raw audio data
   * @param language - Optional language code (ISO 639-1). Auto-detects if omitted.
   * @param format - Audio format of the buffer. Defaults to "mp3".
   */
  async transcribe(
    audioBuffer: Buffer,
    language?: string,
    format: AudioFormat = "mp3",
  ): Promise<TranscriptionResult> {
    if (!audioBuffer.length) {
      throw new Error("Audio buffer must not be empty");
    }

    this.validateFormat(format);

    const resolvedLanguage = language ?? this.defaultLanguage;

    logger.debug(
      {
        format,
        language: resolvedLanguage ?? "auto",
        bufferSize: audioBuffer.length,
      },
      "Starting transcription",
    );

    const startTime = Date.now();

    try {
      // Create a File object from the buffer for the OpenAI SDK
      const file = new File(
        [audioBuffer],
        `audio.${format}`,
        { type: MIME_MAP[format] },
      );

      const response = await this.client.audio.transcriptions.create({
        file,
        model: this.model,
        language: resolvedLanguage,
        temperature: this.temperature,
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
      });

      const durationMs = Date.now() - startTime;

      // The verbose_json response includes segments and metadata
      const verboseResponse = response as unknown as {
        text: string;
        language: string;
        duration: number;
        segments?: Array<{
          id: number;
          start: number;
          end: number;
          text: string;
          temperature: number;
          avg_logprob: number;
          no_speech_prob: number;
        }>;
      };

      const result: TranscriptionResult = {
        text: verboseResponse.text,
        language: verboseResponse.language ?? resolvedLanguage ?? "unknown",
        duration: verboseResponse.duration ?? 0,
        segments: (verboseResponse.segments ?? []).map((seg) => ({
          id: seg.id,
          start: seg.start,
          end: seg.end,
          text: seg.text,
          temperature: seg.temperature,
          avgLogprob: seg.avg_logprob,
          noSpeechProb: seg.no_speech_prob,
        })),
      };

      logger.info(
        {
          language: result.language,
          duration: result.duration,
          segmentCount: result.segments.length,
          transcriptionMs: durationMs,
          textLength: result.text.length,
        },
        "Transcription completed",
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, format }, "Transcription failed");
      throw new Error(`Transcription failed: ${message}`);
    }
  }

  // ─── Language Detection ──────────────────────────────────────────────────

  /**
   * Detect the language of an audio buffer by running a short transcription.
   */
  async detectLanguage(audioBuffer: Buffer, format: AudioFormat = "mp3"): Promise<string> {
    const result = await this.transcribe(audioBuffer, undefined, format);
    return result.language;
  }

  // ─── Validation ──────────────────────────────────────────────────────────

  private validateFormat(format: string): asserts format is AudioFormat {
    if (!SUPPORTED_FORMATS.has(format as AudioFormat)) {
      throw new Error(
        `Unsupported audio format "${format}". Supported: ${Array.from(SUPPORTED_FORMATS).join(", ")}`,
      );
    }
  }
}

// ─── Voice Pipeline ─────────────────────────────────────────────────────────
//
// Orchestrates STT -> Agent -> TTS for voice interactions.
//
// ─────────────────────────────────────────────────────────────────────────────

import pino from "pino";
import { ElevenLabsTTS, type TTSConfig } from "./tts.js";
import { WhisperSTT, type STTConfig, type AudioFormat, type TranscriptionResult } from "./stt.js";

export { ElevenLabsTTS, type TTSConfig, type Voice } from "./tts.js";
export {
  WhisperSTT,
  type STTConfig,
  type AudioFormat,
  type TranscriptionResult,
  type TranscriptionSegment,
} from "./stt.js";

const logger = pino({ name: "voice-pipeline" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VoiceProcessorConfig {
  /** TTS configuration. */
  tts?: TTSConfig;
  /** STT configuration. */
  stt?: STTConfig;
  /** Default audio format for incoming audio. */
  defaultAudioFormat?: AudioFormat;
  /** Default voice ID for TTS output. */
  defaultVoiceId?: string;
}

export interface VoiceProcessingResult {
  /** Transcribed text from the user's audio. */
  transcribedText: string;
  /** Detected language. */
  detectedLanguage: string;
  /** Transcription segments with timestamps. */
  segments: TranscriptionResult["segments"];
  /** Duration of the input audio in seconds. */
  inputDuration: number;
}

// ─── Voice Processor ────────────────────────────────────────────────────────

/**
 * Unified voice processing pipeline.
 *
 * - processVoiceMessage: audio buffer -> transcribed text
 * - generateVoiceResponse: text -> audio buffer
 *
 * Can be composed into a full pipeline:
 * audio in -> STT -> agent processing -> TTS -> audio out
 */
export class VoiceProcessor {
  private readonly tts: ElevenLabsTTS;
  private readonly stt: WhisperSTT;
  private readonly defaultAudioFormat: AudioFormat;
  private readonly defaultVoiceId: string | undefined;

  constructor(config: VoiceProcessorConfig = {}) {
    this.tts = new ElevenLabsTTS(config.tts);
    this.stt = new WhisperSTT(config.stt);
    this.defaultAudioFormat = config.defaultAudioFormat ?? "mp3";
    this.defaultVoiceId = config.defaultVoiceId;

    logger.info("VoiceProcessor initialized");
  }

  // ─── STT: Audio -> Text ──────────────────────────────────────────────────

  /**
   * Process a voice message: transcribe audio to text.
   *
   * @param audioBuffer - Raw audio data
   * @param format - Audio format (defaults to configured default)
   * @param language - Optional language hint for transcription
   * @returns Transcribed text string
   */
  async processVoiceMessage(
    audioBuffer: Buffer,
    format?: AudioFormat,
    language?: string,
  ): Promise<string> {
    const result = await this.processVoiceMessageDetailed(audioBuffer, format, language);
    return result.transcribedText;
  }

  /**
   * Process a voice message with full result details (segments, language, etc.).
   */
  async processVoiceMessageDetailed(
    audioBuffer: Buffer,
    format?: AudioFormat,
    language?: string,
  ): Promise<VoiceProcessingResult> {
    const resolvedFormat = format ?? this.defaultAudioFormat;

    logger.debug(
      { format: resolvedFormat, bufferSize: audioBuffer.length },
      "Processing voice message",
    );

    const startTime = Date.now();
    const transcription = await this.stt.transcribe(audioBuffer, language, resolvedFormat);
    const durationMs = Date.now() - startTime;

    logger.info(
      {
        language: transcription.language,
        textLength: transcription.text.length,
        audioDuration: transcription.duration,
        processingMs: durationMs,
      },
      "Voice message processed",
    );

    return {
      transcribedText: transcription.text,
      detectedLanguage: transcription.language,
      segments: transcription.segments,
      inputDuration: transcription.duration,
    };
  }

  // ─── TTS: Text -> Audio ──────────────────────────────────────────────────

  /**
   * Generate a voice response from text.
   *
   * @param text - Text to synthesize
   * @param voiceId - Optional voice ID override
   * @returns Audio buffer
   */
  async generateVoiceResponse(text: string, voiceId?: string): Promise<Buffer> {
    const resolvedVoiceId = voiceId ?? this.defaultVoiceId;

    logger.debug(
      { textLength: text.length, voiceId: resolvedVoiceId },
      "Generating voice response",
    );

    const startTime = Date.now();
    const audioBuffer = await this.tts.synthesize(text, resolvedVoiceId);
    const durationMs = Date.now() - startTime;

    logger.info(
      {
        textLength: text.length,
        audioSize: audioBuffer.length,
        processingMs: durationMs,
      },
      "Voice response generated",
    );

    return audioBuffer;
  }

  /**
   * Stream a voice response for real-time playback.
   */
  async *streamVoiceResponse(
    text: string,
    voiceId?: string,
  ): AsyncGenerator<Buffer, void, unknown> {
    const resolvedVoiceId = voiceId ?? this.defaultVoiceId;
    yield* this.tts.synthesizeStream(text, resolvedVoiceId);
  }

  // ─── Full Pipeline ───────────────────────────────────────────────────────

  /**
   * Full voice pipeline: audio in -> STT -> process -> TTS -> audio out.
   *
   * @param audioBuffer - Incoming audio
   * @param processText - Function that takes transcribed text and returns a response string
   * @param options - Pipeline options
   * @returns Audio buffer of the spoken response
   */
  async pipeline(
    audioBuffer: Buffer,
    processText: (text: string) => Promise<string>,
    options?: {
      audioFormat?: AudioFormat;
      language?: string;
      voiceId?: string;
    },
  ): Promise<{ inputText: string; outputText: string; audio: Buffer }> {
    logger.debug("Starting full voice pipeline");
    const startTime = Date.now();

    // 1. STT: audio -> text
    const inputText = await this.processVoiceMessage(
      audioBuffer,
      options?.audioFormat,
      options?.language,
    );

    // 2. Process text (e.g., pass through agent)
    const outputText = await processText(inputText);

    // 3. TTS: text -> audio
    const audio = await this.generateVoiceResponse(outputText, options?.voiceId);

    const durationMs = Date.now() - startTime;
    logger.info(
      {
        inputTextLength: inputText.length,
        outputTextLength: outputText.length,
        audioSize: audio.length,
        totalMs: durationMs,
      },
      "Voice pipeline completed",
    );

    return { inputText, outputText, audio };
  }

  // ─── Accessors ────────────────────────────────────────────────────────────

  /** Access the underlying TTS engine. */
  get ttsEngine(): ElevenLabsTTS {
    return this.tts;
  }

  /** Access the underlying STT engine. */
  get sttEngine(): WhisperSTT {
    return this.stt;
  }
}

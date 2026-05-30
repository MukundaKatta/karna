import { z } from 'zod';
import { EventEmitter } from 'node:events';
import type { Logger } from 'pino';

/**
 * Issue #603 — Streaming STT/TTS pipeline.
 *
 * Abstractions for streaming partial transcripts (STT) and incremental audio
 * chunks (TTS) built around async iterables / EventEmitter with backpressure.
 *
 * This module is purely additive: it does not change the existing
 * {@link STTProvider} / {@link TTSProvider} synchronous (one-shot) contracts.
 * Real providers can adopt the streaming interfaces incrementally; until then
 * the in-memory mock implementations here are fully usable and testable.
 */

export const StreamingConfigSchema = z.object({
  /** Maximum number of buffered items before producers should pause (backpressure). */
  highWaterMark: z.number().int().min(1).default(16),
  /** Emit a partial transcript at most this often (ms); 0 = no throttling. */
  partialIntervalMs: z.number().int().min(0).default(0),
});

export type StreamingConfig = z.infer<typeof StreamingConfigSchema>;

/** A partial (interim) or final transcript emitted by a streaming STT session. */
export interface PartialTranscript {
  text: string;
  isFinal: boolean;
  /** Stable id of the in-progress utterance; final replaces all earlier partials with same id. */
  utteranceId: string;
  timestampMs: number;
  confidence?: number;
}

/** An incremental synthesized audio chunk emitted by a streaming TTS session. */
export interface AudioChunkOut {
  data: Buffer;
  sequence: number;
  /** True when this is the last chunk of the synthesized utterance. */
  isFinal: boolean;
  mimeType: string;
}

/**
 * A bounded async queue acting as a single-producer/single-consumer channel
 * with backpressure. `push` resolves only once there is room under the
 * high-water mark, so producers naturally slow to the consumer's pace.
 */
export class BackpressureQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private closed = false;
  private error: Error | null = null;
  private pendingPush: Array<() => void> = [];
  private pendingPull: Array<(r: IteratorResult<T>) => void> = [];
  private pendingReject: Array<(e: Error) => void> = [];

  constructor(private readonly highWaterMark = 16) {}

  get size(): number {
    return this.buffer.length;
  }

  /** Push an item; resolves when accepted (i.e. once below the high-water mark). */
  push(item: T): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('cannot push to a closed queue'));
    }
    // Hand directly to a waiting consumer if any.
    const pull = this.pendingPull.shift();
    if (pull) {
      this.pendingReject.shift();
      pull({ value: item, done: false });
      return Promise.resolve();
    }
    this.buffer.push(item);
    if (this.buffer.length < this.highWaterMark) {
      return Promise.resolve();
    }
    // At/over the limit: wait until the consumer drains below it.
    return new Promise<void>((resolve) => {
      this.pendingPush.push(resolve);
    });
  }

  /** Signal that no more items will be pushed. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pull of this.pendingPull.splice(0)) {
      this.pendingReject.shift();
      pull({ value: undefined as unknown as T, done: true });
    }
  }

  /** Abort the queue, rejecting outstanding and future pulls. */
  fail(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.error = err;
    this.pendingPull.splice(0);
    for (const reject of this.pendingReject.splice(0)) {
      reject(err);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.error) throw this.error;
      if (this.buffer.length > 0) {
        const value = this.buffer.shift() as T;
        // Releasing capacity may unblock a waiting producer.
        const resume = this.pendingPush.shift();
        if (resume) resume();
        yield value;
        continue;
      }
      if (this.closed) {
        if (this.error) throw this.error;
        return;
      }
      const result = await new Promise<IteratorResult<T>>((resolve, reject) => {
        this.pendingPull.push(resolve);
        this.pendingReject.push(reject);
      });
      if (result.done) return;
      yield result.value;
    }
  }
}

/** Streaming STT: feed audio chunks, receive partial + final transcripts. */
export interface StreamingSTTSession {
  /** Feed an audio chunk. Resolves under backpressure once accepted. */
  pushAudio(chunk: Buffer): Promise<void>;
  /** Signal end of audio; the final transcript(s) will follow then the stream ends. */
  end(): Promise<void>;
  /** Async iterable of interim/final transcripts. */
  transcripts(): AsyncIterable<PartialTranscript>;
  /** Abort the session immediately. */
  abort(reason?: string): void;
}

export interface StreamingSTTProvider {
  startStream(config?: Partial<StreamingConfig>): StreamingSTTSession;
}

/** Streaming TTS: provide text (possibly incrementally), receive audio chunks. */
export interface StreamingTTSSession {
  /** Feed a span of text to synthesize. */
  pushText(text: string): Promise<void>;
  /** Signal end of text; remaining audio is flushed then the stream ends. */
  end(): Promise<void>;
  /** Async iterable of incremental audio chunks. */
  chunks(): AsyncIterable<AudioChunkOut>;
  /** Abort synthesis immediately. */
  abort(reason?: string): void;
}

export interface StreamingTTSProvider {
  startStream(config?: Partial<StreamingConfig>): StreamingTTSSession;
}

/**
 * In-memory mock streaming STT. Emits one interim partial per pushed audio
 * chunk and a single final transcript on `end()`. Useful for tests and as a
 * reference adapter shape for real providers.
 */
export class MockStreamingSTTProvider extends EventEmitter implements StreamingSTTProvider {
  constructor(private readonly logger?: Logger) {
    super();
  }

  startStream(config?: Partial<StreamingConfig>): StreamingSTTSession {
    const cfg = StreamingConfigSchema.parse(config ?? {});
    const queue = new BackpressureQueue<PartialTranscript>(cfg.highWaterMark);
    const utteranceId = `utt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const logger = this.logger;
    const emitter = this;
    let words = 0;
    let ended = false;

    return {
      async pushAudio(chunk: Buffer): Promise<void> {
        if (ended) throw new Error('cannot push audio after end');
        words += 1;
        logger?.debug({ size: chunk.length, words }, 'mock streaming stt chunk');
        const partial: PartialTranscript = {
          text: `[partial ${words}]`,
          isFinal: false,
          utteranceId,
          timestampMs: Date.now(),
          confidence: 0.5,
        };
        emitter.emit('partial', partial);
        await queue.push(partial);
      },
      async end(): Promise<void> {
        if (ended) return;
        ended = true;
        const final: PartialTranscript = {
          text: `[final ${words} segments]`,
          isFinal: true,
          utteranceId,
          timestampMs: Date.now(),
          confidence: 0.95,
        };
        emitter.emit('final', final);
        await queue.push(final);
        queue.close();
      },
      transcripts(): AsyncIterable<PartialTranscript> {
        return queue;
      },
      abort(reason?: string): void {
        ended = true;
        emitter.emit('abort', reason);
        queue.fail(new Error(reason ?? 'stt aborted'));
      },
    };
  }
}

/**
 * In-memory mock streaming TTS. Emits one audio chunk per pushed text span and
 * a final empty terminator chunk on `end()`.
 */
export class MockStreamingTTSProvider extends EventEmitter implements StreamingTTSProvider {
  constructor(private readonly logger?: Logger) {
    super();
  }

  startStream(config?: Partial<StreamingConfig>): StreamingTTSSession {
    const cfg = StreamingConfigSchema.parse(config ?? {});
    const queue = new BackpressureQueue<AudioChunkOut>(cfg.highWaterMark);
    const logger = this.logger;
    const emitter = this;
    let sequence = 0;
    let ended = false;

    return {
      async pushText(text: string): Promise<void> {
        if (ended) throw new Error('cannot push text after end');
        const chunk: AudioChunkOut = {
          data: Buffer.from(`mock-audio:${text}`),
          sequence: sequence++,
          isFinal: false,
          mimeType: 'audio/mpeg',
        };
        logger?.debug({ length: text.length, sequence: chunk.sequence }, 'mock streaming tts chunk');
        emitter.emit('chunk', chunk);
        await queue.push(chunk);
      },
      async end(): Promise<void> {
        if (ended) return;
        ended = true;
        const chunk: AudioChunkOut = {
          data: Buffer.alloc(0),
          sequence: sequence++,
          isFinal: true,
          mimeType: 'audio/mpeg',
        };
        emitter.emit('chunk', chunk);
        await queue.push(chunk);
        queue.close();
      },
      chunks(): AsyncIterable<AudioChunkOut> {
        return queue;
      },
      abort(reason?: string): void {
        ended = true;
        emitter.emit('abort', reason);
        queue.fail(new Error(reason ?? 'tts aborted'));
      },
    };
  }
}

/** Plain one-shot transcript result collected from a streaming STT session. */
export interface CollectedTranscript {
  text: string;
  durationMs: number;
  confidence?: number;
}

/** Collect a streaming STT session into a single one-shot transcript. */
export async function collectTranscript(session: StreamingSTTSession): Promise<CollectedTranscript> {
  let finalText = '';
  let confidence: number | undefined;
  const start = Date.now();
  for await (const t of session.transcripts()) {
    if (t.isFinal) {
      finalText = t.text;
      confidence = t.confidence;
    }
  }
  return { text: finalText, durationMs: Date.now() - start, confidence };
}

/** Collect a streaming TTS session's chunks into a single audio Buffer. */
export async function collectAudio(session: StreamingTTSSession): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of session.chunks()) {
    if (c.data.length > 0) parts.push(c.data);
  }
  return Buffer.concat(parts);
}

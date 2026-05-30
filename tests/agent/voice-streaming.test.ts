import { describe, it, expect } from 'vitest';
import {
  BackpressureQueue,
  MockStreamingSTTProvider,
  MockStreamingTTSProvider,
  collectTranscript,
  collectAudio,
} from '../../agent/src/voice/streaming.js';

describe('BackpressureQueue', () => {
  it('delivers pushed items in order', async () => {
    const q = new BackpressureQueue<number>(10);
    await q.push(1);
    await q.push(2);
    q.close();
    const out: number[] = [];
    for await (const v of q) out.push(v);
    expect(out).toEqual([1, 2]);
  });

  it('applies backpressure at the high-water mark', async () => {
    const q = new BackpressureQueue<number>(2);
    await q.push(1); // buffer 1
    let resolved = false;
    const p = q.push(2).then(() => { // buffer hits 2 -> blocks
      resolved = true;
    });
    // give the microtask queue a chance
    await Promise.resolve();
    expect(resolved).toBe(false);

    // draining one item should unblock the pending push
    const it = q[Symbol.asyncIterator]();
    await it.next(); // consume 1
    await p;
    expect(resolved).toBe(true);
  });

  it('supports consumer waiting before producer', async () => {
    const q = new BackpressureQueue<string>(4);
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    await q.push('hi');
    const result = await pending;
    expect(result).toEqual({ value: 'hi', done: false });
  });

  it('propagates failure to the consumer', async () => {
    const q = new BackpressureQueue<number>(4);
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    q.fail(new Error('boom'));
    await expect(pending).rejects.toThrow('boom');
  });
});

describe('MockStreamingSTTProvider', () => {
  it('emits partials per chunk and a final on end', async () => {
    const session = new MockStreamingSTTProvider().startStream();
    const collected: string[] = [];
    const reader = (async () => {
      for await (const t of session.transcripts()) {
        collected.push(`${t.isFinal ? 'final' : 'partial'}:${t.text}`);
      }
    })();
    await session.pushAudio(Buffer.from('a'));
    await session.pushAudio(Buffer.from('b'));
    await session.end();
    await reader;
    expect(collected).toEqual(['partial:[partial 1]', 'partial:[partial 2]', 'final:[final 2 segments]']);
  });

  it('collectTranscript returns the final text', async () => {
    const session = new MockStreamingSTTProvider().startStream();
    await session.pushAudio(Buffer.from('a'));
    await session.end();
    const result = await collectTranscript(session);
    expect(result.text).toBe('[final 1 segments]');
    expect(result.confidence).toBe(0.95);
  });
});

describe('MockStreamingTTSProvider', () => {
  it('emits an audio chunk per text span and a final terminator', async () => {
    const session = new MockStreamingTTSProvider().startStream();
    await session.pushText('hello');
    await session.pushText(' world');
    await session.end();
    const audio = await collectAudio(session);
    expect(audio.toString()).toBe('mock-audio:hellomock-audio: world');
  });
});

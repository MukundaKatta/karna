import { describe, it, expect, vi } from "vitest";
import {
  STREAMING_TOOL_RESULT,
  consumeStream,
  createStreamingToolResult,
  isStreamingToolResult,
  StreamAbortError,
  type StreamingToolResult,
} from "../../agent/src/tools/streaming.js";

/** Build a streaming result from a fixed list of partials + a final value. */
function fromList<P>(partials: P[], final: unknown): StreamingToolResult<P, unknown> {
  async function* gen(): AsyncGenerator<P> {
    for (const p of partials) yield p;
  }
  return createStreamingToolResult(gen(), () => final);
}

describe("streaming tool results (#550)", () => {
  describe("isStreamingToolResult", () => {
    it("detects the contract", () => {
      expect(isStreamingToolResult(fromList([1, 2], "done"))).toBe(true);
    });

    it("rejects plain values and single-value tool outputs", () => {
      expect(isStreamingToolResult(null)).toBe(false);
      expect(isStreamingToolResult("text")).toBe(false);
      expect(isStreamingToolResult({ output: "x" })).toBe(false);
      expect(isStreamingToolResult(Promise.resolve("x"))).toBe(false);
    });

    it("uses a registered symbol brand", () => {
      const stream = fromList([], "f");
      expect((stream as Record<symbol, unknown>)[STREAMING_TOOL_RESULT]).toBe(true);
    });
  });

  describe("consumeStream", () => {
    it("emits partials in order and resolves the final value", async () => {
      const stream = fromList(["a", "b", "c"], "FINAL");
      const partials: string[] = [];
      const indexes: number[] = [];
      const final = await consumeStream(stream, {
        onPartial: (p, i) => {
          partials.push(p);
          indexes.push(i);
        },
      });
      expect(partials).toEqual(["a", "b", "c"]);
      expect(indexes).toEqual([0, 1, 2]);
      expect(final).toBe("FINAL");
    });

    it("works without an onPartial callback", async () => {
      const final = await consumeStream(fromList([1, 2], 99));
      expect(final).toBe(99);
    });

    it("reduces collected partials into the final value", async () => {
      async function* gen(): AsyncGenerator<number> {
        yield 1;
        yield 2;
        yield 3;
      }
      const stream = createStreamingToolResult(gen(), (parts) =>
        parts.reduce((a, b) => a + b, 0)
      );
      const seen: number[] = [];
      const final = await consumeStream(stream, { onPartial: (p) => seen.push(p) });
      expect(seen).toEqual([1, 2, 3]);
      expect(final).toBe(6);
    });

    it("rejects immediately if the signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        consumeStream(fromList([1, 2], "x"), { signal: controller.signal })
      ).rejects.toBeInstanceOf(StreamAbortError);
    });

    it("aborts mid-stream and invokes iterator return() for cleanup", async () => {
      const controller = new AbortController();
      let returned = false;

      // A hand-rolled streaming result that blocks after the first partial.
      const stream: StreamingToolResult<number, string> = {
        [STREAMING_TOOL_RESULT]: true,
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            async next() {
              if (i === 0) {
                i++;
                return { done: false, value: 1 };
              }
              // Block forever until aborted; consumeStream races the abort.
              return new Promise<IteratorResult<number>>(() => {});
            },
            async return() {
              returned = true;
              return { done: true, value: undefined };
            },
          };
        },
        async final() {
          return "never";
        },
      };

      const seen: number[] = [];
      const promise = consumeStream(stream, {
        signal: controller.signal,
        onPartial: (p) => {
          seen.push(p);
          // Abort right after receiving the first partial.
          controller.abort();
        },
      });

      await expect(promise).rejects.toBeInstanceOf(StreamAbortError);
      expect(seen).toEqual([1]);
      expect(returned).toBe(true);
    });

    it("propagates errors thrown by the underlying stream", async () => {
      async function* gen(): AsyncGenerator<number> {
        yield 1;
        throw new Error("boom");
      }
      const stream = createStreamingToolResult(gen(), () => "x");
      await expect(consumeStream(stream)).rejects.toThrow("boom");
    });
  });

  describe("createStreamingToolResult", () => {
    it("final() drains the source even if not iterated explicitly", async () => {
      const reduce = vi.fn((parts: number[]) => parts.length);
      async function* gen(): AsyncGenerator<number> {
        yield 1;
        yield 2;
      }
      const stream = createStreamingToolResult(gen(), reduce);
      const final = await stream.final();
      expect(final).toBe(2);
      expect(reduce).toHaveBeenCalledTimes(1);
    });

    it("final() is memoized across calls", async () => {
      const reduce = vi.fn(() => "once");
      const stream = createStreamingToolResult((async function* () {})(), reduce);
      const a = await stream.final();
      const b = await stream.final();
      expect(a).toBe(b);
      expect(reduce).toHaveBeenCalledTimes(1);
    });
  });
});

// ─── Streaming Tool Results (#550) ───────────────────────────────────────────
//
// An OPTIONAL contract that lets a tool emit incremental partial results while
// it works, before producing a single final value. This is fully additive and
// non-breaking: existing tools return a single `Promise<unknown>` and are
// unaffected. A tool MAY instead return (or have its output be) a
// `StreamingToolResult`, which the agent loop can consume via `consumeStream`
// to surface partials (e.g. token-by-token, progress events) while still
// reducing to one final value to feed back to the model.
//
// Nothing here changes `ToolDefinitionRuntime` or `executeTool`. Callers opt in
// by detecting the contract with `isStreamingToolResult` and consuming it.
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Brand used to reliably detect the streaming contract at runtime, even across
 * module/realm boundaries (avoids relying solely on `instanceof`).
 */
export const STREAMING_TOOL_RESULT = Symbol.for("karna.tool.streamingResult");

/**
 * The OPTIONAL async-iterable tool-result contract.
 *
 * - `[Symbol.asyncIterator]` yields zero or more `Partial` chunks.
 * - `final()` resolves to the single `Final` value once iteration completes.
 *
 * Implementations should ensure that, after the async iterator is fully
 * drained, `final()` resolves. `consumeStream` enforces this ordering.
 *
 * @typeParam Partial - the type of incremental chunks.
 * @typeParam Final   - the type of the single final value.
 */
export interface StreamingToolResult<Partial = unknown, Final = unknown> {
  readonly [STREAMING_TOOL_RESULT]: true;
  [Symbol.asyncIterator](): AsyncIterator<Partial>;
  /** Resolves with the final value after the stream completes. */
  final(): Promise<Final>;
}

/**
 * Type guard: does `value` implement the streaming tool-result contract?
 */
export function isStreamingToolResult(
  value: unknown
): value is StreamingToolResult {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[STREAMING_TOOL_RESULT] === true &&
    typeof (value as { final?: unknown }).final === "function" &&
    typeof (value as Record<symbol, unknown>)[Symbol.asyncIterator] === "function"
  );
}

/**
 * Callbacks for {@link consumeStream}.
 */
export interface ConsumeStreamOptions<Partial = unknown> {
  /** Invoked once per emitted partial chunk, in order. */
  onPartial?: (partial: Partial, index: number) => void;
  /**
   * Abort signal. If aborted before/while consuming, iteration stops and
   * `consumeStream` rejects with an `AbortError`-style error. If the underlying
   * iterator exposes `return()`, it is called to allow cleanup.
   */
  signal?: AbortSignal;
}

/**
 * Error thrown when consumption is aborted via an `AbortSignal`.
 */
export class StreamAbortError extends Error {
  constructor(message = "Stream consumption aborted") {
    super(message);
    this.name = "StreamAbortError";
  }
}

/**
 * Drive a {@link StreamingToolResult} to completion: emit each partial to
 * `onPartial` (in order) and resolve with the final value.
 *
 * Supports cooperative cancellation via `options.signal`. On abort, the
 * underlying async iterator's `return()` (if present) is invoked for cleanup
 * and the returned promise rejects with {@link StreamAbortError}.
 *
 * This is a pure consumer: it performs no I/O of its own and is driven entirely
 * by the injected stream + callbacks, making it straightforward to unit-test.
 */
export async function consumeStream<Partial = unknown, Final = unknown>(
  stream: StreamingToolResult<Partial, Final>,
  options: ConsumeStreamOptions<Partial> = {}
): Promise<Final> {
  const { onPartial, signal } = options;

  if (signal?.aborted) {
    throw new StreamAbortError();
  }

  const iterator = stream[Symbol.asyncIterator]();
  let index = 0;

  // Listener resolves a pending abort promise so we can race it against next().
  let abortReject: ((err: unknown) => void) | undefined;
  const onAbort = (): void => abortReject?.(new StreamAbortError());
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  try {
    for (;;) {
      if (signal?.aborted) {
        throw new StreamAbortError();
      }

      const nextPromise = iterator.next();
      const step = signal
        ? await Promise.race([
            nextPromise,
            new Promise<never>((_, reject) => {
              abortReject = reject;
            }),
          ])
        : await nextPromise;

      if (step.done) break;
      onPartial?.(step.value, index++);
    }

    return await stream.final();
  } catch (err) {
    // Best-effort cleanup of the underlying iterator on early exit/abort.
    if (typeof iterator.return === "function") {
      try {
        await iterator.return(undefined);
      } catch {
        // Ignore cleanup errors; the original error is more important.
      }
    }
    throw err;
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Build a {@link StreamingToolResult} from an `AsyncIterable` of partials plus
 * a reducer that produces the final value.
 *
 * The reducer receives the array of collected partials (in emission order) and
 * returns (sync or async) the final value. Useful for adapting existing
 * async-generator-based tools to the streaming contract without boilerplate.
 *
 * Note: the source iterable is consumed exactly once. After it is drained,
 * `final()` resolves; calling `final()` before draining will drain it first.
 */
export function createStreamingToolResult<Partial = unknown, Final = unknown>(
  source: AsyncIterable<Partial>,
  reduce: (partials: Partial[]) => Final | Promise<Final>
): StreamingToolResult<Partial, Final> {
  const collected: Partial[] = [];
  let drained = false;
  let finalValue: Final;
  let finalComputed = false;
  let finalPromise: Promise<Final> | undefined;

  const sourceIterator = source[Symbol.asyncIterator]();

  const iterator: AsyncIterator<Partial> = {
    async next(): Promise<IteratorResult<Partial>> {
      const step = await sourceIterator.next();
      if (step.done) {
        drained = true;
        return { done: true, value: undefined };
      }
      collected.push(step.value);
      return { done: false, value: step.value };
    },
    async return(value?: unknown): Promise<IteratorResult<Partial>> {
      drained = true;
      if (typeof sourceIterator.return === "function") {
        await sourceIterator.return(value as Partial | undefined);
      }
      return { done: true, value: undefined };
    },
  };

  const computeFinal = async (): Promise<Final> => {
    if (finalComputed) return finalValue;
    // Ensure the source is fully drained before reducing.
    if (!drained) {
      for (;;) {
        const step = await iterator.next();
        if (step.done) break;
      }
    }
    finalValue = await reduce(collected);
    finalComputed = true;
    return finalValue;
  };

  return {
    [STREAMING_TOOL_RESULT]: true,
    [Symbol.asyncIterator](): AsyncIterator<Partial> {
      return iterator;
    },
    final(): Promise<Final> {
      finalPromise ??= computeFinal();
      return finalPromise;
    },
  };
}

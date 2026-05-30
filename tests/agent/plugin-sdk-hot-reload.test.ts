import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createDebouncer,
  createHotReloadWatcher,
  type WatchFn,
} from "../../packages/plugin-sdk/src/hot-reload.js";

describe("plugin-sdk hot-reload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createDebouncer (pure debounce/dedupe core)", () => {
    it("collapses a burst into a single flush and dedupes keys", () => {
      const flush = vi.fn();
      const d = createDebouncer(flush, 200);
      d.push("a.ts");
      d.push("b.ts");
      d.push("a.ts"); // duplicate within window
      expect(d.pending()).toBe(2); // deduped
      expect(flush).not.toHaveBeenCalled();

      vi.advanceTimersByTime(200);

      expect(flush).toHaveBeenCalledTimes(1);
      expect([...flush.mock.calls[0][0]].sort()).toEqual(["a.ts", "b.ts"]);
      expect(d.pending()).toBe(0);
    });

    it("does not flush empty batches and supports cancel", () => {
      const flush = vi.fn();
      const d = createDebouncer(flush, 100);
      d.push("x.ts");
      d.cancel();
      vi.advanceTimersByTime(500);
      expect(flush).not.toHaveBeenCalled();
      expect(d.pending()).toBe(0);
    });

    it("resets the quiet window on each push", () => {
      const flush = vi.fn();
      const d = createDebouncer(flush, 100);
      d.push("a");
      vi.advanceTimersByTime(80);
      d.push("b"); // resets the timer
      vi.advanceTimersByTime(80);
      expect(flush).not.toHaveBeenCalled();
      vi.advanceTimersByTime(20);
      expect(flush).toHaveBeenCalledTimes(1);
    });
  });

  describe("HotReloadWatcher (injectable watchFn, no real fs)", () => {
    // A fake watch implementation that lets the test emit synthetic events.
    function makeFakeWatch() {
      let listener: ((eventType: string, filename: string | null) => void) | null = null;
      let closed = false;
      const watchFn: WatchFn = (_dir, l) => {
        listener = l;
        return {
          close() {
            closed = true;
          },
        };
      };
      return {
        watchFn,
        emit: (filename: string | null) => listener?.("change", filename),
        isClosed: () => closed,
      };
    }

    it("debounces fs events and invokes the re-register callback once", async () => {
      const fake = makeFakeWatch();
      const onReload = vi.fn(async () => {});
      const w = createHotReloadWatcher({
        dir: "/skills",
        onReload,
        debounceMs: 50,
        watchFn: fake.watchFn,
      });
      w.start();

      fake.emit("a.ts");
      fake.emit("a.ts"); // duplicate
      fake.emit("b.ts");
      fake.emit(null); // ignored

      await vi.advanceTimersByTimeAsync(50);

      expect(onReload).toHaveBeenCalledTimes(1);
      const event = onReload.mock.calls[0][0];
      expect(event.dir).toBe("/skills");
      expect([...event.files].sort()).toEqual(["a.ts", "b.ts"]);
      w.stop();
      expect(fake.isClosed()).toBe(true);
    });

    it("applies the filter predicate", async () => {
      const fake = makeFakeWatch();
      const onReload = vi.fn(async () => {});
      const w = createHotReloadWatcher({
        dir: "/skills",
        onReload,
        debounceMs: 20,
        watchFn: fake.watchFn,
        filter: (f) => f.endsWith(".ts"),
      });
      w.start();
      fake.emit("keep.ts");
      fake.emit("ignore.md");
      await vi.advanceTimersByTimeAsync(20);
      expect(onReload).toHaveBeenCalledTimes(1);
      expect(onReload.mock.calls[0][0].files).toEqual(["keep.ts"]);
    });

    it("dedupes overlapping async runs and flushes mid-run changes afterwards", async () => {
      const fake = makeFakeWatch();
      const order: string[] = [];
      let resolveFirst: () => void = () => {};
      const onReload = vi.fn(async (event: { files: string[] }) => {
        order.push("start:" + event.files.join(","));
        if (onReload.mock.calls.length === 1) {
          await new Promise<void>((res) => {
            resolveFirst = res;
          });
        }
        order.push("end:" + event.files.join(","));
      });

      const w = createHotReloadWatcher({
        dir: "/skills",
        onReload,
        debounceMs: 10,
        watchFn: fake.watchFn,
      });
      w.start();

      fake.emit("first.ts");
      await vi.advanceTimersByTimeAsync(10); // first run starts then awaits

      fake.emit("second.ts"); // arrives while first run is in flight
      await vi.advanceTimersByTimeAsync(10);

      // First run still pending; no second run yet.
      expect(order).toEqual(["start:first.ts"]);

      resolveFirst();
      await vi.runAllTimersAsync();

      expect(order).toEqual([
        "start:first.ts",
        "end:first.ts",
        "start:second.ts",
        "end:second.ts",
      ]);
    });

    it("start() is idempotent and stop() is safe to call repeatedly", () => {
      const fake = makeFakeWatch();
      const w = createHotReloadWatcher({
        dir: "/skills",
        onReload: async () => {},
        watchFn: fake.watchFn,
      });
      w.start();
      w.start(); // no-op
      w.stop();
      w.stop(); // safe
      expect(fake.isClosed()).toBe(true);
    });

    it("swallows callback errors so the watcher keeps running", async () => {
      const fake = makeFakeWatch();
      const errors: unknown[] = [];
      const w = createHotReloadWatcher({
        dir: "/skills",
        onReload: async () => {
          throw new Error("boom");
        },
        debounceMs: 10,
        watchFn: fake.watchFn,
        logger: {
          info: () => {},
          warn: () => {},
          debug: () => {},
          error: (_msg, e) => errors.push(e),
        },
      });
      w.start();
      fake.emit("x.ts");
      await expect(vi.advanceTimersByTimeAsync(10)).resolves.not.toThrow();
      expect((errors[0] as Error).message).toBe("boom");
      w.stop();
    });
  });
});

/**
 * Dev-only hot-reload watcher for skills/plugins (Issue #616).
 *
 * Wraps node:fs.watch with debouncing and dedupe so a flurry of editor save
 * events collapses into a single safe re-registration call. This is a no-op
 * until `start()` is explicitly invoked, so importing it has zero side effects.
 *
 * Designed to be testable without real filesystem access: the debounce/dedupe
 * core is exposed via `createDebouncer` and the watcher accepts an injectable
 * `watchFn` so tests can drive change events synthetically.
 */
import { watch as fsWatch, type FSWatcher } from 'node:fs';

export type ReloadReason = 'rename' | 'change';

export interface ReloadEvent {
  /** The directory being watched. */
  dir: string;
  /** Distinct filenames that changed in this debounced batch. */
  files: string[];
}

export type ReregisterCallback = (
  event: ReloadEvent,
) => void | Promise<void>;

/** Minimal shape of a watch function, matching node:fs.watch's relevant bits. */
export type WatchFn = (
  dir: string,
  listener: (eventType: string, filename: string | null) => void,
) => { close: () => void };

export interface HotReloadOptions {
  /** Directory to watch. */
  dir: string;
  /** Called (debounced) with the set of changed files. */
  onReload: ReregisterCallback;
  /** Debounce window in ms. Default 150. */
  debounceMs?: number;
  /**
   * Only fire for files matching this predicate (e.g. `.ts`/`.js`).
   * Default: accept everything.
   */
  filter?: (filename: string) => boolean;
  /** Logger; defaults to a no-op. */
  logger?: {
    info: (msg: string, ...a: unknown[]) => void;
    warn: (msg: string, ...a: unknown[]) => void;
    error: (msg: string, ...a: unknown[]) => void;
    debug: (msg: string, ...a: unknown[]) => void;
  };
  /** Injectable watch implementation (for testing). Defaults to node:fs.watch. */
  watchFn?: WatchFn;
}

const noopLogger: NonNullable<HotReloadOptions['logger']> = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/**
 * A debouncer that accumulates distinct string keys and flushes them once the
 * quiet window elapses. Pure logic — no fs involved — so it is unit-testable.
 */
export interface Debouncer {
  /** Record a changed key (deduped within the current batch). */
  push: (key: string) => void;
  /** Number of pending distinct keys not yet flushed. */
  pending: () => number;
  /** Cancel any scheduled flush and drop pending keys. */
  cancel: () => void;
}

export function createDebouncer(
  flush: (keys: string[]) => void,
  debounceMs = 150,
): Debouncer {
  let pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const keys = Array.from(pending);
      pending = new Set();
      if (keys.length > 0) flush(keys);
    }, debounceMs);
    // Don't keep the event loop alive solely for the watcher.
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref?: () => void }).unref?.();
    }
  };

  return {
    push(key: string) {
      pending.add(key);
      schedule();
    },
    pending() {
      return pending.size;
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = new Set();
    },
  };
}

/**
 * Hot-reload watcher. Construct it, then call `start()` to begin watching.
 * It is inert until started and safe to `stop()` multiple times.
 */
export class HotReloadWatcher {
  private opts: Required<
    Pick<HotReloadOptions, 'dir' | 'onReload' | 'debounceMs' | 'filter' | 'logger' | 'watchFn'>
  >;
  private watcher: { close: () => void } | null = null;
  private debouncer: Debouncer | null = null;
  /** Guards against overlapping async re-registrations (dedupe in-flight). */
  private running = false;
  private rerunQueued = false;
  private queuedFiles = new Set<string>();

  constructor(options: HotReloadOptions) {
    this.opts = {
      dir: options.dir,
      onReload: options.onReload,
      debounceMs: options.debounceMs ?? 150,
      filter: options.filter ?? (() => true),
      logger: options.logger ?? noopLogger,
      watchFn:
        options.watchFn ??
        ((dir, listener) => fsWatch(dir, listener) as FSWatcher),
    };
  }

  /** Begin watching. No-op if already started. */
  start(): void {
    if (this.watcher) return;
    this.debouncer = createDebouncer(
      (files) => void this.handleFlush(files),
      this.opts.debounceMs,
    );
    this.watcher = this.opts.watchFn(this.opts.dir, (_eventType, filename) => {
      if (!filename) return;
      if (!this.opts.filter(filename)) return;
      this.debouncer?.push(filename);
    });
    this.opts.logger.info(`hot-reload watching ${this.opts.dir}`);
  }

  /** Stop watching and clear pending work. Safe to call repeatedly. */
  stop(): void {
    this.debouncer?.cancel();
    this.debouncer = null;
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        /* ignore close errors */
      }
      this.watcher = null;
    }
  }

  private async handleFlush(files: string[]): Promise<void> {
    // Dedupe overlapping runs: if a reload is already in flight, coalesce the
    // new files and re-run once the current run finishes.
    for (const f of files) this.queuedFiles.add(f);
    if (this.running) {
      this.rerunQueued = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.rerunQueued = false;
        const batch = Array.from(this.queuedFiles);
        this.queuedFiles.clear();
        try {
          await this.opts.onReload({ dir: this.opts.dir, files: batch });
        } catch (err) {
          this.opts.logger.error('hot-reload re-registration failed', err);
        }
      } while (this.rerunQueued && this.queuedFiles.size > 0);
    } finally {
      this.running = false;
    }
  }
}

/**
 * Convenience factory. Returns an inert watcher — you must call `.start()`.
 */
export function createHotReloadWatcher(
  options: HotReloadOptions,
): HotReloadWatcher {
  return new HotReloadWatcher(options);
}

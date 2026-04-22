import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface SessionMapLogger {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

interface SessionMapSnapshot<TSerialized> {
  version: 1;
  entries: Array<{
    key: string;
    value: TSerialized;
  }>;
}

export interface PersistentSessionMapOptions<
  TKey extends string | number,
  TValue,
  TSerialized = TValue,
> {
  name: string;
  storagePath?: string;
  logger?: SessionMapLogger;
  debounceMs?: number;
  serialize?: (value: TValue) => TSerialized;
  deserialize?: (value: TSerialized) => TValue;
  serializeKey?: (key: TKey) => string;
  deserializeKey?: (key: string) => TKey;
}

const DEFAULT_SESSION_DIR = join(homedir(), ".karna", "channel-sessions");

export function getDefaultChannelSessionStorePath(name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-");
  return join(DEFAULT_SESSION_DIR, `${safeName}.json`);
}

export class PersistentSessionMap<
  TKey extends string | number,
  TValue,
  TSerialized = TValue,
> {
  private readonly map = new Map<TKey, TValue>();
  private readonly storagePath: string;
  private readonly logger?: SessionMapLogger;
  private readonly debounceMs: number;
  private readonly serializeValue: (value: TValue) => TSerialized;
  private readonly deserializeValue: (value: TSerialized) => TValue;
  private readonly serializeKeyFn: (key: TKey) => string;
  private readonly deserializeKeyFn: (key: string) => TKey;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistChain: Promise<void> = Promise.resolve();
  private loaded = false;
  private persistenceEnabled = false;

  constructor(options: PersistentSessionMapOptions<TKey, TValue, TSerialized>) {
    this.storagePath = options.storagePath ?? getDefaultChannelSessionStorePath(options.name);
    this.logger = options.logger;
    this.debounceMs = options.debounceMs ?? 100;
    this.serializeValue =
      options.serialize ?? ((value: TValue) => value as unknown as TSerialized);
    this.deserializeValue =
      options.deserialize ?? ((value: TSerialized) => value as unknown as TValue);
    this.serializeKeyFn =
      options.serializeKey ?? ((key: TKey) => String(key));
    this.deserializeKeyFn =
      options.deserializeKey ??
      ((key: string) => key as unknown as TKey);
  }

  get size(): number {
    return this.map.size;
  }

  get(key: TKey): TValue | undefined {
    return this.map.get(key);
  }

  has(key: TKey): boolean {
    return this.map.has(key);
  }

  set(key: TKey, value: TValue): this {
    this.map.set(key, value);
    this.schedulePersist();
    return this;
  }

  delete(key: TKey): boolean {
    const deleted = this.map.delete(key);
    if (deleted) {
      this.schedulePersist();
    }
    return deleted;
  }

  clear(): void {
    if (this.map.size === 0) return;
    this.map.clear();
    this.schedulePersist();
  }

  entries(): IterableIterator<[TKey, TValue]> {
    return this.map.entries();
  }

  values(): IterableIterator<TValue> {
    return this.map.values();
  }

  keys(): IterableIterator<TKey> {
    return this.map.keys();
  }

  [Symbol.iterator](): IterableIterator<[TKey, TValue]> {
    return this.map[Symbol.iterator]();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    this.persistenceEnabled = true;

    try {
      const raw = await readFile(this.storagePath, "utf-8");
      const parsed = JSON.parse(raw) as SessionMapSnapshot<TSerialized>;

      if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
        this.logger?.warn?.(
          { storagePath: this.storagePath },
          "Ignoring malformed session map snapshot",
        );
        return;
      }

      this.map.clear();

      for (const entry of parsed.entries) {
        if (!entry || typeof entry.key !== "string") continue;

        try {
          const key = this.deserializeKeyFn(entry.key);
          const value = this.deserializeValue(entry.value);
          this.map.set(key, value);
        } catch (error) {
          this.logger?.warn?.(
            {
              storagePath: this.storagePath,
              key: entry.key,
              error: String(error),
            },
            "Skipping malformed persisted session entry",
          );
        }
      }

      if (this.map.size > 0) {
        this.logger?.info?.(
          { storagePath: this.storagePath, entryCount: this.map.size },
          "Restored persisted session map",
        );
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return;

      this.logger?.warn?.(
        { storagePath: this.storagePath, error: String(error) },
        "Failed to restore persisted session map",
      );
    }
  }

  async flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    await this.enqueuePersist();
  }

  private schedulePersist(): void {
    if (!this.persistenceEnabled) return;

    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }

    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.enqueuePersist();
    }, this.debounceMs);
  }

  private enqueuePersist(): Promise<void> {
    const snapshot: SessionMapSnapshot<TSerialized> = {
      version: 1,
      entries: Array.from(this.map.entries()).map(([key, value]) => ({
        key: this.serializeKeyFn(key),
        value: this.serializeValue(value),
      })),
    };

    this.persistChain = this.persistChain.then(async () => {
      const tempPath = `${this.storagePath}.tmp`;

      try {
        await mkdir(dirname(this.storagePath), { recursive: true });

        if (snapshot.entries.length === 0) {
          await rm(this.storagePath, { force: true });
          return;
        }

        await writeFile(tempPath, JSON.stringify(snapshot, null, 2) + "\n", "utf-8");
        await rename(tempPath, this.storagePath);
        this.logger?.debug?.(
          { storagePath: this.storagePath, entryCount: snapshot.entries.length },
          "Persisted session map",
        );
      } catch (error) {
        this.logger?.warn?.(
          { storagePath: this.storagePath, error: String(error) },
          "Failed to persist session map",
        );
      } finally {
        await rm(tempPath, { force: true }).catch(() => {});
      }
    });

    return this.persistChain;
  }
}

// ─── Filesystem Path Scoping (Issue #558) ────────────────────────────────────
//
// Confine a (possibly attacker-controlled) path to a scoped root directory.
// Resolves and normalizes the path, then rejects any result that escapes the
// root — defeating `../` traversal, absolute-path escapes, and (on POSIX)
// embedded NUL bytes.
//
// This module is PURE: it performs no filesystem I/O. It only reasons about
// path strings using node's `path` module, so it is fully deterministic and
// testable. It does NOT change executor behavior; callers opt in by invoking
// `resolveScoped` before touching the filesystem.

import { posix as posixPath, win32 as win32Path, sep as nativeSep } from "node:path";

/** Outcome of a scoped path resolution. */
export type ScopeResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

export interface ResolveScopedOptions {
  /**
   * Path flavor to use. Defaults to "auto" which picks based on the runtime
   * platform; pass "posix"/"win32" explicitly for deterministic tests.
   */
  flavor?: "posix" | "win32" | "auto";
  /**
   * When true, allow the resolved path to equal the root itself. Default true.
   * When false, only strict descendants of the root are allowed.
   */
  allowRoot?: boolean;
}

/**
 * Thrown by `resolveScopedOrThrow` when a path escapes its scope.
 */
export class PathScopeError extends Error {
  constructor(
    public readonly root: string,
    public readonly requested: string,
    public readonly reason: string,
  ) {
    super(`Path "${requested}" is outside the scoped root "${root}": ${reason}`);
    this.name = "PathScopeError";
  }
}

function pickPath(flavor: ResolveScopedOptions["flavor"]) {
  if (flavor === "posix") return posixPath;
  if (flavor === "win32") return win32Path;
  return nativeSep === "\\" ? win32Path : posixPath;
}

/**
 * Resolve `p` relative to `root` and confine the result to `root`.
 *
 * Returns a structured result rather than throwing, so callers can surface a
 * model-friendly error. The returned path is always absolute and normalized.
 *
 * Rejections:
 *  - NUL byte in either input (poison-null-byte attacks)
 *  - resolved path escapes the root (`..` traversal / absolute escape)
 *  - empty root
 */
export function resolveScoped(
  root: string,
  p: string,
  options: ResolveScopedOptions = {},
): ScopeResult {
  const path = pickPath(options.flavor);
  const allowRoot = options.allowRoot ?? true;

  if (root.length === 0) {
    return { ok: false, reason: "empty root" };
  }
  if (root.includes("\0") || p.includes("\0")) {
    return { ok: false, reason: "path contains NUL byte" };
  }

  // Normalize the root to an absolute, canonical form.
  const normalizedRoot = path.resolve(root);

  // Resolve the requested path *against* the root. Because `path.resolve`
  // discards earlier segments when a later one is absolute, an absolute `p`
  // would escape — so we strip a leading separator and treat `p` as relative
  // to the root. `..` segments are then collapsed by resolve and caught below.
  const candidate = path.resolve(normalizedRoot, stripLeadingRoot(path, p));

  if (!isInside(path, normalizedRoot, candidate, allowRoot)) {
    return { ok: false, reason: "path traversal escapes scoped root" };
  }

  return { ok: true, path: candidate };
}

/**
 * Throwing variant of {@link resolveScoped}. Returns the confined absolute path
 * or throws {@link PathScopeError}.
 */
export function resolveScopedOrThrow(
  root: string,
  p: string,
  options: ResolveScopedOptions = {},
): string {
  const result = resolveScoped(root, p, options);
  if (!result.ok) {
    throw new PathScopeError(root, p, result.reason);
  }
  return result.path;
}

/** Whether `p` resolves to a location inside `root` (without throwing). */
export function isPathInScope(
  root: string,
  p: string,
  options: ResolveScopedOptions = {},
): boolean {
  return resolveScoped(root, p, options).ok;
}

/** Strip a leading path separator (or Windows drive) so `p` is treated as relative. */
function stripLeadingRoot(path: typeof posixPath | typeof win32Path, p: string): string {
  // Treat an absolute requested path as relative to the root rather than
  // letting it escape. On win32 also strip a drive prefix like "C:".
  let s = p;
  if (path === win32Path) {
    s = s.replace(/^[a-zA-Z]:/, "");
  }
  return s.replace(/^[/\\]+/, "");
}

/** Whether `candidate` is the same as `root` (if allowed) or a descendant. */
function isInside(
  path: typeof posixPath | typeof win32Path,
  root: string,
  candidate: string,
  allowRoot: boolean,
): boolean {
  if (candidate === root) {
    return allowRoot;
  }
  const rel = path.relative(root, candidate);
  // `rel` escapes root if it is empty (handled above), starts with `..`, or is
  // an absolute path (different drive on win32).
  if (rel.length === 0) {
    return allowRoot;
  }
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return false;
  }
  return true;
}

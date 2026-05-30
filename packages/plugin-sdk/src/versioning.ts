/**
 * Tool & skill versioning and deprecation metadata helpers (Issue #549).
 *
 * Additive, optional metadata: a definition may carry an optional semver
 * `version` and a `deprecated` block. These helpers never throw on missing
 * metadata — they degrade gracefully so existing definitions keep working.
 */
import { z } from 'zod';

/** Loose semver pattern: MAJOR.MINOR.PATCH with optional -prerelease / +build. */
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

export const SemverSchema = z
  .string()
  .regex(SEMVER_RE, 'must be a valid semver string (e.g. 1.2.3)');

export const DeprecationInfoSchema = z.object({
  /** Version (or date) at which this entity became deprecated. */
  since: z.string().min(1),
  /** Optional name of the replacement tool/skill. */
  replacement: z.string().min(1).optional(),
  /** Optional version/date after which it will be removed entirely. */
  sunset: z.string().min(1).optional(),
  /** Optional human-readable reason. */
  reason: z.string().min(1).optional(),
});

export type DeprecationInfo = z.infer<typeof DeprecationInfoSchema>;

/**
 * Optional versioning metadata that can be mixed into any definition's
 * metadata object without breaking existing consumers.
 */
export const VersionedMetadataSchema = z.object({
  version: SemverSchema.optional(),
  deprecated: DeprecationInfoSchema.optional(),
});

export type VersionedMetadata = z.infer<typeof VersionedMetadataSchema>;

/** Anything carrying an optional `metadata` object with optional version info. */
export interface VersionedLike {
  metadata?: {
    name?: string;
    version?: string;
    deprecated?: DeprecationInfo;
    [k: string]: unknown;
  };
}

export interface DeprecationWarning {
  /** Name of the entity (best-effort; falls back to '<unknown>'). */
  name: string;
  message: string;
  since: string;
  replacement?: string;
  sunset?: string;
  /** True when the sunset marker has been reached/passed (see isSunset). */
  sunsetReached: boolean;
}

/** Parse a semver string into a comparable tuple, or null if invalid. */
export function parseSemver(
  v: string,
): { major: number; minor: number; patch: number } | null {
  const m = SEMVER_RE.exec(v);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function isValidSemver(v: string): boolean {
  return SEMVER_RE.test(v);
}

/**
 * Compare two semver strings (ignoring prerelease/build).
 * Returns -1, 0, 1, or null if either is invalid.
 */
export function compareSemver(a: string, b: string): number | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return 0;
}

/**
 * Determine whether a sunset marker has been reached, given an optional
 * "current" reference. Supports either a semver `currentVersion` (compared
 * against a semver sunset) or a `now` Date (compared against a date sunset).
 */
export function isSunset(
  dep: DeprecationInfo,
  opts: { currentVersion?: string; now?: Date } = {},
): boolean {
  if (!dep.sunset) return false;
  // Semver-style sunset.
  if (opts.currentVersion && isValidSemver(dep.sunset)) {
    const cmp = compareSemver(opts.currentVersion, dep.sunset);
    return cmp !== null && cmp >= 0;
  }
  // Date-style sunset.
  const sunsetTime = Date.parse(dep.sunset);
  if (!Number.isNaN(sunsetTime)) {
    const now = (opts.now ?? new Date()).getTime();
    return now >= sunsetTime;
  }
  return false;
}

/**
 * Inspect a definition (tool, skill, etc.) for deprecation metadata and
 * return a warning if present, otherwise null. Never throws.
 */
export function checkDeprecation(
  entity: VersionedLike,
  opts: { currentVersion?: string; now?: Date } = {},
): DeprecationWarning | null {
  const dep = entity?.metadata?.deprecated;
  if (!dep) return null;
  const name = entity.metadata?.name ?? '<unknown>';
  const sunsetReached = isSunset(dep, opts);

  let message = `"${name}" is deprecated since ${dep.since}.`;
  if (dep.reason) message += ` ${dep.reason}`;
  if (dep.replacement) message += ` Use "${dep.replacement}" instead.`;
  if (dep.sunset) {
    message += sunsetReached
      ? ` It has reached its sunset (${dep.sunset}) and may be removed.`
      : ` Scheduled for removal at ${dep.sunset}.`;
  }

  return {
    name,
    message,
    since: dep.since,
    replacement: dep.replacement,
    sunset: dep.sunset,
    sunsetReached,
  };
}

/**
 * Check many definitions at once, returning only those that produced a warning.
 */
export function checkDeprecations(
  entities: VersionedLike[],
  opts: { currentVersion?: string; now?: Date } = {},
): DeprecationWarning[] {
  const out: DeprecationWarning[] = [];
  for (const e of entities) {
    const w = checkDeprecation(e, opts);
    if (w) out.push(w);
  }
  return out;
}

/**
 * Convenience helper to attach version/deprecation metadata to an existing
 * metadata object without mutating the original (returns a new object).
 */
export function withVersion<T extends Record<string, unknown>>(
  metadata: T,
  info: VersionedMetadata,
): T & VersionedMetadata {
  const parsed = VersionedMetadataSchema.parse(info);
  return { ...metadata, ...parsed };
}

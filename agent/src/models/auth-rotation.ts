// ─── Auth Profile Rotation ──────────────────────────────────────────────────
// Rotate between multiple API key profiles for load distribution
// and fallback when one key hits rate limits.

import pino from "pino";

const logger = pino({ name: "auth-rotation" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuthProfile {
  id: string;
  provider: string;
  apiKey: string;
  /** Max requests per minute for this key */
  rateLimit?: number;
  /** Current request count in the current window */
  requestCount: number;
  /** When the current rate limit window resets */
  windowResetAt: number;
  /** Whether this profile is currently disabled (e.g., auth error) */
  disabled: boolean;
  /** When this profile was last used */
  lastUsedAt: number;
}

// ─── Auth Profile Manager ──────────────────────────────────────────────────

export class AuthProfileManager {
  private readonly profiles = new Map<string, AuthProfile[]>(); // provider -> profiles
  private readonly windowMs: number;

  constructor(windowMs = 60_000) {
    this.windowMs = windowMs;
  }

  /**
   * Register an API key profile.
   */
  addProfile(provider: string, apiKey: string, rateLimit?: number): void {
    let providerProfiles = this.profiles.get(provider);
    if (!providerProfiles) {
      providerProfiles = [];
      this.profiles.set(provider, providerProfiles);
    }

    providerProfiles.push({
      id: `${provider}_${providerProfiles.length}`,
      provider,
      apiKey,
      rateLimit,
      requestCount: 0,
      windowResetAt: Date.now() + this.windowMs,
      disabled: false,
      lastUsedAt: 0,
    });

    logger.info({ provider, profileCount: providerProfiles.length }, "Auth profile added");
  }

  /**
   * Get the best available API key for a provider.
   * Uses round-robin with rate limit awareness.
   */
  getApiKey(provider: string): string | null {
    const providerProfiles = this.profiles.get(provider);
    if (!providerProfiles || providerProfiles.length === 0) {
      return null;
    }

    const now = Date.now();

    // Reset windows that have expired
    for (const profile of providerProfiles) {
      if (now > profile.windowResetAt) {
        profile.requestCount = 0;
        profile.windowResetAt = now + this.windowMs;
      }
    }

    // Find the best available profile
    const available = providerProfiles.filter((p) => {
      if (p.disabled) return false;
      if (p.rateLimit && p.requestCount >= p.rateLimit) return false;
      return true;
    });

    if (available.length === 0) {
      // All profiles exhausted — try disabled ones
      const reEnabled = providerProfiles.filter((p) => !p.disabled);
      if (reEnabled.length > 0) {
        // Use the least recently used
        reEnabled.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
        const profile = reEnabled[0]!;
        profile.requestCount++;
        profile.lastUsedAt = now;
        logger.warn({ provider, profileId: profile.id }, "All profiles rate-limited, using least-recent");
        return profile.apiKey;
      }

      logger.error({ provider }, "All auth profiles disabled");
      return null;
    }

    // Round-robin: use the least recently used
    available.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    const selected = available[0]!;
    selected.requestCount++;
    selected.lastUsedAt = now;

    logger.debug({ provider, profileId: selected.id, requestCount: selected.requestCount }, "Selected auth profile");
    return selected.apiKey;
  }

  /**
   * Mark a profile as having an auth error (disables it).
   */
  markAuthError(provider: string, apiKey: string): void {
    const providerProfiles = this.profiles.get(provider);
    if (!providerProfiles) return;

    const profile = providerProfiles.find((p) => p.apiKey === apiKey);
    if (profile) {
      profile.disabled = true;
      logger.warn({ provider, profileId: profile.id }, "Auth profile disabled due to error");
    }
  }

  /**
   * Mark a profile as rate-limited.
   */
  markRateLimited(provider: string, apiKey: string, retryAfterMs?: number): void {
    const providerProfiles = this.profiles.get(provider);
    if (!providerProfiles) return;

    const profile = providerProfiles.find((p) => p.apiKey === apiKey);
    if (profile) {
      profile.requestCount = profile.rateLimit ?? 999;
      if (retryAfterMs) {
        profile.windowResetAt = Date.now() + retryAfterMs;
      }
      logger.warn({ provider, profileId: profile.id, retryAfterMs }, "Auth profile rate-limited");
    }
  }

  /**
   * Re-enable a disabled profile.
   */
  reEnable(provider: string, apiKey: string): void {
    const providerProfiles = this.profiles.get(provider);
    if (!providerProfiles) return;

    const profile = providerProfiles.find((p) => p.apiKey === apiKey);
    if (profile) {
      profile.disabled = false;
      logger.info({ provider, profileId: profile.id }, "Auth profile re-enabled");
    }
  }

  /**
   * Get profile count for a provider.
   */
  getProfileCount(provider: string): number {
    return this.profiles.get(provider)?.length ?? 0;
  }

  /**
   * Get all profiles for a provider (for diagnostics).
   */
  getProfiles(provider: string): Omit<AuthProfile, "apiKey">[] {
    return (this.profiles.get(provider) ?? []).map(({ apiKey, ...rest }) => rest);
  }
}

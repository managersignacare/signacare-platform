/**
 * apps/api/src/shared/featureFlags.ts
 *
 * S4.2 — Feature flag service
 *
 * Lightweight in-house feature toggle system. Mirrors the public API
 * shape of Unleash (isEnabled / list / set) so a future migration to
 * Unleash is a service-layer swap, not a rewrite of every call site.
 *
 * Storage: feature_flags table (one row per (clinic_id, name)). The
 * lookup picks the most-specific row first: per-clinic if it exists,
 * otherwise the global row, otherwise default-disabled.
 *
 * Caching: in-memory map with a TTL. Hot path is a single Map.get().
 * Default TTL is 60 seconds; admin endpoints invalidate the cache on
 * write so toggles take effect within the next request, not the next
 * minute.
 *
 * Naming compliance: function exports camelCase, DB columns
 * snake_case, flag names are lowercase + hyphen (e.g.
 * 'scribe-live-transcript-beta', 'rag-context-v1') and validated by
 * a regex at write time so they survive future Unleash migration.
 */

import { db, dbAdmin, rlsStore } from '../db/db';
import { logger } from '../utils/logger';
import { AppError } from './errors';
import { withTenantContext } from './tenantContext';

interface FeatureFlagRow {
  id: string;
  clinic_id: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  rollout_percentage: number;
  created_at: Date;
  updated_at: Date;
}

const FLAG_NAME_REGEX = /^[a-z][a-z0-9-]{0,99}$/;
export function isValidFlagName(name: string): boolean {
  return typeof name === 'string' && FLAG_NAME_REGEX.test(name);
}

interface CacheEntry {
  resolved: boolean;
  rolloutPercentage: number;
  cachedAt: number;
}

const CACHE_TTL_MS = 60_000;
const CLEANUP_INTERVAL_MS = 5 * 60_000;
const cache = new Map<string, CacheEntry>();

// Phase 0.7.2: Active eviction of expired entries. Without this,
// the cache grows with every unique (clinic, flag) pair and expired
// entries are only removed lazily on the next lookup for that key.
const _cleanupTimer = setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of cache) {
    if (now - entry.cachedAt > CACHE_TTL_MS) {
      cache.delete(key);
      removed++;
    }
  }
  if (removed > 0 && process.env.NODE_ENV !== 'test') {
    // Intentionally no logger import — this runs at module scope
    // and the logger may not be initialised yet on first tick.
    // eslint-disable-next-line no-console
    console.debug(`[featureFlags] evicted ${removed} expired entries, ${cache.size} remaining`);
  }
}, CLEANUP_INTERVAL_MS);
_cleanupTimer.unref();

// BUG-042 — clear the cache-cleanup setInterval at priority 85 so no
// tick fires during DB pool destroy. unref() already means the timer
// doesn't block process exit, but explicit clear is consistent with
// the other schedulers and allows the cleanup hook timing to be
// verified by tests. No require-cycle risk: gracefulShutdown only
// imports logger, which is self-contained (pino + OTEL).
import { registerShutdownHook as __registerShutdownHook_fflags } from './gracefulShutdown';
if (process.env.NODE_ENV !== 'test') {
  __registerShutdownHook_fflags({
    name: 'feature-flags:cleanup-timer',
    priority: 85,
    handler: async () => { clearInterval(_cleanupTimer); },
  });
}

function cacheKey(clinicId: string | null, name: string): string {
  return `${clinicId ?? 'global'}::${name}`;
}

function invalidateCacheFor(name: string): void {
  for (const key of cache.keys()) {
    if (key.endsWith(`::${name}`)) cache.delete(key);
  }
}

/** Test/diagnostic helper — clear the entire cache. */
export function _resetFeatureFlagCache(): void {
  cache.clear();
}

/**
 * Hash a string into a 0-99 integer for the gradual-rollout decision.
 * Cheap, deterministic, and uniformly distributed across staff IDs.
 * NOT cryptographic — same shape as Unleash's normalisedHash.
 */
function rolloutBucket(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return Math.abs(hash) % 100;
}

interface FlagContext {
  /** Optional staff ID for gradual-rollout decisions. */
  staffId?: string;
}

/**
 * Resolve whether a feature is enabled for a given (clinicId, name)
 * pair. Returns the cached result when available.
 *
 * Lookup order:
 *   1. Per-tenant row (clinic_id = ?, name = ?)
 *   2. Global row (clinic_id IS NULL, name = ?)
 *   3. Default false
 *
 * Once a row is found, the rollout_percentage is applied via the
 * staffId hash if a staffId is in context. Without a staffId,
 * rollout_percentage is treated as a binary all-or-nothing.
 */
export async function isFeatureEnabled(
  name: string,
  clinicId: string | null,
  ctx: FlagContext = {},
): Promise<boolean> {
  if (!isValidFlagName(name)) {
    logger.warn({ name }, 'isFeatureEnabled: invalid flag name, treating as disabled');
    return false;
  }
  const key = cacheKey(clinicId, name);
  const cached = cache.get(key);
  const now = Date.now();
  let resolved: boolean;
  let rolloutPercentage: number;

  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    resolved = cached.resolved;
    rolloutPercentage = cached.rolloutPercentage;
  } else {
    try {
      // Try clinic-specific first, then fall back to global.
      //
      // Read via dbAdmin (owner connection) instead of the request-scoped
      // `db` proxy: feature-flag resolution is cross-cutting config look-up
      // and must remain stable even when called from async tails where the
      // ambient request transaction has already completed.
      let row: FeatureFlagRow | undefined;
      if (clinicId) {
        if (rlsStore.getStore()) {
          row = await dbAdmin<FeatureFlagRow>('feature_flags')
            .where({ clinic_id: clinicId, name })
            .first();
        } else {
          // Under FORCE RLS posture, out-of-request lookups with no
          // tenant GUC return zero rows and can poison the cache with
          // false negatives. Resolve clinic flags inside an explicit
          // tenant context so cache entries remain truthful.
          row = await withTenantContext(clinicId, async () => (
            dbAdmin<FeatureFlagRow>('feature_flags')
              .where({ clinic_id: clinicId, name })
              .first()
          ));
        }
      }
      if (!row) {
        row = await dbAdmin<FeatureFlagRow>('feature_flags')
          .whereNull('clinic_id')
          .where({ name })
          .first();
      }
      if (row) {
        resolved = row.enabled;
        rolloutPercentage = row.rollout_percentage;
      } else {
        resolved = false;
        rolloutPercentage = 0;
      }
      cache.set(key, { resolved, rolloutPercentage, cachedAt: now });
    } catch (err) {
      // DB error -> fail closed (feature off). Logged but never thrown.
      logger.warn({ err, name, clinicId }, 'isFeatureEnabled: lookup failed, defaulting off');
      return false;
    }
  }

  if (!resolved) return false;
  if (rolloutPercentage >= 100) return true;
  if (rolloutPercentage <= 0) return false;
  if (!ctx.staffId) return true; // no per-staff context, treat as binary on
  return rolloutBucket(`${name}:${ctx.staffId}`) < rolloutPercentage;
}

/** Bulk lookup. Used by the admin UI and the frontend bootstrap. */
export async function listFeatureFlags(clinicId: string | null): Promise<Array<{
  name: string;
  enabled: boolean;
  rolloutPercentage: number;
  description: string | null;
  scope: 'clinic' | 'global';
}>> {
  // Pull both global rows and per-clinic rows. Per-clinic shadows global.
  const globalRows = await db<FeatureFlagRow>('feature_flags').whereNull('clinic_id');
  const tenantRows = clinicId
    ? await db<FeatureFlagRow>('feature_flags').where({ clinic_id: clinicId })
    : [];
  const merged = new Map<string, { row: FeatureFlagRow; scope: 'clinic' | 'global' }>();
  for (const row of globalRows) merged.set(row.name, { row, scope: 'global' });
  for (const row of tenantRows) merged.set(row.name, { row, scope: 'clinic' });
  return Array.from(merged.values()).map(({ row, scope }) => ({
    name: row.name,
    enabled: row.enabled,
    rolloutPercentage: row.rollout_percentage,
    description: row.description,
    scope,
  }));
}

interface SetFlagInput {
  name: string;
  enabled: boolean;
  rolloutPercentage?: number;
  description?: string;
  /** null for global flag, otherwise the clinic this row applies to. */
  clinicId: string | null;
}

export async function setFeatureFlag(input: SetFlagInput): Promise<void> {
  if (!isValidFlagName(input.name)) {
    throw new AppError('Invalid flag name', 400, 'INVALID_FLAG_NAME');
  }
  const rolloutPercentage = Math.max(0, Math.min(100, input.rolloutPercentage ?? 100));
  // For global rows, clinic_id is NULL — knex's onConflict cannot
  // include NULL in a unique index, so we branch on clinicId.
  if (input.clinicId === null) {
    const existing = await db<FeatureFlagRow>('feature_flags')
      .whereNull('clinic_id')
      .where({ name: input.name })
      .first();
    if (existing) {
      await db('feature_flags').where({ id: existing.id }).update({
        enabled: input.enabled,
        rollout_percentage: rolloutPercentage,
        description: input.description ?? existing.description,
        updated_at: new Date(),
      });
    } else {
      await db('feature_flags').insert({
        clinic_id: null,
        name: input.name,
        description: input.description ?? null,
        enabled: input.enabled,
        rollout_percentage: rolloutPercentage,
      });
    }
  } else {
    await db('feature_flags')
      .insert({
        clinic_id: input.clinicId,
        name: input.name,
        description: input.description ?? null,
        enabled: input.enabled,
        rollout_percentage: rolloutPercentage,
      })
      .onConflict(['clinic_id', 'name'])
      .merge({
        enabled: input.enabled,
        rollout_percentage: rolloutPercentage,
        description: input.description ?? null,
        updated_at: new Date(),
      });
  }
  invalidateCacheFor(input.name);
}

export async function deleteFeatureFlag(name: string, clinicId: string | null): Promise<void> {
  const q = db('feature_flags').where({ name });
  if (clinicId === null) q.whereNull('clinic_id');
  else q.where({ clinic_id: clinicId });
  await q.delete();
  invalidateCacheFor(name);
}

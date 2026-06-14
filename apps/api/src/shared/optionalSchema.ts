import { dbAdmin } from '../db/db';

interface TablePresenceCacheEntry {
  expiresAt: number | null;
  promise: Promise<boolean>;
}

const tablePresenceCache = new Map<string, TablePresenceCacheEntry>();
export const OPTIONAL_TABLE_FALSE_CACHE_TTL_MS = 30_000;

/**
 * Runtime schema feature gate for additive rollouts.
 *
 * Some staging/demo environments can briefly run newer API code against
 * an older schema during rollback / forward-fix windows. Callers can
 * detect whether an additive table exists and fall back to the legacy
 * path while the schema catches up.
 *
 * Operational stance:
 *   - `true` is sticky for the process lifetime because tables do not
 *     disappear during a healthy forward rollout.
 *   - `false` is cached briefly so rollback windows do not hammer the
 *     catalog, then re-probed after the TTL.
 *   - schema-probe errors degrade to `false` for the same short TTL so
 *     calendar and appointment read paths keep using the legacy branch
 *     instead of surfacing a transient metadata failure as a 500.
 */
export function hasOptionalTable(tableName: string): Promise<boolean> {
  const now = Date.now();
  const cached = tablePresenceCache.get(tableName);
  if (cached && (cached.expiresAt === null || cached.expiresAt > now)) {
    return cached.promise;
  }

  const pending = dbAdmin.schema
    .hasTable(tableName)
    .then((exists) => {
      tablePresenceCache.set(tableName, {
        expiresAt: exists ? null : Date.now() + OPTIONAL_TABLE_FALSE_CACHE_TTL_MS,
        promise: Promise.resolve(exists),
      });
      return exists;
    })
    .catch(() => {
      const fallbackFalse = Promise.resolve(false);
      tablePresenceCache.set(tableName, {
        expiresAt: Date.now() + OPTIONAL_TABLE_FALSE_CACHE_TTL_MS,
        promise: fallbackFalse,
      });
      return false;
    });
  tablePresenceCache.set(tableName, {
    expiresAt: now + OPTIONAL_TABLE_FALSE_CACHE_TTL_MS,
    promise: pending,
  });
  return pending;
}

export function resetOptionalTableCacheForTests(): void {
  tablePresenceCache.clear();
}

import { dbAdmin } from '../db/db';

const tablePresenceCache = new Map<string, Promise<boolean>>();

/**
 * Runtime schema feature gate for additive rollouts.
 *
 * Some staging/demo environments can briefly run newer API code against
 * an older schema during rollback / forward-fix windows. Rather than
 * 500 every calendar surface immediately, callers can detect whether an
 * additive table exists and fall back to the legacy path.
 */
export function hasOptionalTable(tableName: string): Promise<boolean> {
  const cached = tablePresenceCache.get(tableName);
  if (cached) {
    return cached;
  }

  const pending = dbAdmin.schema
    .hasTable(tableName)
    .catch(() => false);
  tablePresenceCache.set(tableName, pending);
  return pending;
}

export function resetOptionalTableCacheForTests(): void {
  tablePresenceCache.clear();
}

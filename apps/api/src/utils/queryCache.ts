/**
 * Redis-backed query cache for read-heavy dashboard / stats queries.
 *
 * Usage:
 *   const stats = await cachedQuery('org:stats', 60, () => db('patients').count('*'));
 *
 * TTL in seconds. Cache is per-clinic where needed:
 *   await cachedQuery(`clinic:${clinicId}:dashboard`, 30, () => buildDashboard(clinicId));
 */

import { redis } from '../config/redis';

export async function cachedQuery<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const cached = await redis.get(`cache:${key}`);
    if (cached) return JSON.parse(cached);
  } catch {
    // Redis unavailable — fall through to DB
    void 0;
  }

  const result = await fn();

  try {
    await redis.setex(`cache:${key}`, ttlSeconds, JSON.stringify(result));
  } catch {
    // Non-fatal — result still returned from DB
    void 0;
  }

  return result;
}

/** Invalidate a specific cache key */
export async function invalidateCache(key: string): Promise<void> {
  try {
    await redis.del(`cache:${key}`);
  } catch {
    void 0;
  }
}

/** Invalidate all cache keys matching a pattern */
export async function invalidateCachePattern(pattern: string): Promise<void> {
  try {
    const keys = await redis.keys(`cache:${pattern}`);
    if (keys.length) await redis.del(...keys);
  } catch {
    void 0;
  }
}

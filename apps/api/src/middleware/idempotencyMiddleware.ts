/**
 * S1.2 — Idempotency-Key middleware
 *
 * Implements RFC-style Idempotency-Key handling for clinical write
 * endpoints. Network retries on saturated nginx links or slow LLM
 * calls used to silently double-create medications, appointments,
 * orders, referrals, and clinical notes — for an EMR, that is a
 * patient-safety bug, not a UX annoyance. With this middleware, a
 * client can safely retry any POST that includes an `Idempotency-Key`
 * header without worrying about duplicates.
 *
 * Behaviour:
 *
 *   1. If the request has no `Idempotency-Key` header, the middleware
 *      is a pure pass-through. Existing clients keep working unchanged.
 *
 *   2. On the first request with a given key, the middleware grabs a
 *      short Redis lock (60s TTL). If the lock cannot be acquired, a
 *      concurrent in-flight request with the same key is presumed —
 *      we return 409 to make the client wait and retry.
 *
 *   3. The middleware wraps res.json so that the FIRST successful
 *      response (or 4xx error response) is captured into Redis under
 *      the cache key, with a 24h TTL. The lock is then released.
 *
 *   4. Subsequent requests with the same key return the cached
 *      response immediately, with the original status code.
 *
 * The cache key includes clinic_id and staff_id, so the same
 * Idempotency-Key value used by two different clinicians (or two
 * different clinics) is treated as two distinct operations. This
 * matches Stripe's behaviour and is the safe default.
 *
 * Naming compliance:
 *   - Function exports camelCase
 *   - Redis key namespace `idemp:` (lowercase, colon-separated — Redis idiom)
 *   - HTTP header `Idempotency-Key` (HTTP standard, dash-cased)
 *
 * What this middleware does NOT do:
 *   - It does not verify the request body matches the cached body.
 *     If a client reuses an Idempotency-Key with a different payload,
 *     they get the original response. Stripe rejects this case; we
 *     intentionally do not, because the EMR clients are first-party
 *     and adding payload-hash storage doubles the Redis footprint.
 *   - It does not deduplicate at the DB level. The middleware short-
 *     circuits before the handler runs, so the underlying repository
 *     never sees the second request.
 */

import type { Request, Response, NextFunction } from 'express';
import { redisCache } from '../config/redis';
import { logger } from '../utils/logger';

const HEADER = 'idempotency-key';
const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const LOCK_TTL_MS = 60_000; // 60 seconds — generous upper bound on a single request

interface CachedResponse {
  status: number;
  body: unknown;
  /** ISO timestamp when this response was first cached. Useful for diagnosing replays. */
  cachedAt: string;
}

/**
 * Build the Redis cache key. Includes clinic_id + staff_id so the same
 * key value cannot be replayed across tenants or accounts.
 */
function buildCacheKey(req: Request, key: string): string {
  const clinicId = req.clinicId ?? 'noclinic';
  const staffId = req.user?.id ?? 'nouser';
  // Route key is the matched Express route path (req.route?.path) when
  // available, falling back to the original URL. Either is stable per
  // logical endpoint.
  const routeKey = req.route?.path ?? req.originalUrl.split('?')[0];
  return `idemp:${clinicId}:${staffId}:${req.method}:${routeKey}:${key}`;
}

function buildLockKey(cacheKey: string): string {
  return `${cacheKey}:lock`;
}

/**
 * Express middleware factory. Apply selectively to clinical-write routes
 * by adding it to the route's middleware chain (NOT app-level — this is
 * deliberately opt-in per endpoint).
 *
 *   router.post('/medications', idempotencyMiddleware(), createMedication);
 *
 * The factory takes no options today; it exists as a function so future
 * per-route configuration (custom TTL, scope tweaks) is non-breaking.
 */
export function idempotencyMiddleware() {
  return async function idempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
    const headerValue = req.header(HEADER);
    if (!headerValue) {
      // No header — pure pass-through. Existing clients unaffected.
      next();
      return;
    }

    // Reject pathologically large keys to prevent Redis abuse
    if (headerValue.length > 256) {
      res.status(400).json({ error: 'idempotency_key_too_long', message: 'Idempotency-Key must be <= 256 chars' });
      return;
    }

    const cacheKey = buildCacheKey(req, headerValue);
    const lockKey = buildLockKey(cacheKey);

    // 1. Check for an existing cached response
    let cached: string | null = null;
    try {
      cached = await redisCache.get(cacheKey);
    } catch (err) {
      // Redis is down — fail open (pass through). Logging only; do not
      // block clinical writes because the cache is unavailable.
      logger.warn({ err }, 'idempotency: redis get failed, passing through');
      next();
      return;
    }

    if (cached) {
      try {
        const parsed = JSON.parse(cached) as CachedResponse;
        res.status(parsed.status).json(parsed.body);
        return;
      } catch {
        // Corrupt cache entry — fall through and treat as a fresh request
        logger.warn({ cacheKey }, 'idempotency: corrupt cache entry, treating as new');
      }
    }

    // 2. Try to acquire the lock. SET NX PX is atomic in Redis.
    let lockOk: 'OK' | null = null;
    try {
      lockOk = await redisCache.set(lockKey, '1', 'PX', LOCK_TTL_MS, 'NX');
    } catch (err) {
      logger.warn({ err }, 'idempotency: redis set lock failed, passing through');
      next();
      return;
    }
    if (!lockOk) {
      // A concurrent request with the same key is in flight. The client
      // should wait briefly and retry — we return 409 (Conflict).
      res.status(409).json({
        error: 'idempotency_key_in_use',
        message: 'Another request with this Idempotency-Key is already in flight. Retry shortly.',
      });
      return;
    }

    // 3. Wrap res.json to capture the response. We capture only the
    //    FIRST call (subsequent calls would be a coding bug in the
    //    handler). Both 2xx successes and 4xx errors are cached so the
    //    client gets identical results on replay.
    const originalJson = res.json.bind(res);
    let captured = false;
    res.json = function patchedJson(body: unknown): Response {
      if (!captured) {
        captured = true;
        const status = res.statusCode || 200;
        // Only cache "well-formed" responses — never 5xx (those are
        // probably transient and the client SHOULD be allowed to retry
        // and succeed).
        if (status < 500) {
          const payload: CachedResponse = {
            status,
            body,
            cachedAt: new Date().toISOString(),
          };
          // Fire-and-forget the cache write; the response goes out
          // immediately. The lock is released regardless of cache
          // write success — we cannot block the response on Redis
          // latency. .catch() prevents an unhandled rejection.
          redisCache
            .set(cacheKey, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS)
            .catch((err) => logger.warn({ err }, 'idempotency: cache write failed'));
        }
        // Always release the lock so future requests with the same key
        // get the cached response (or a clean retry on 5xx).
        redisCache.del(lockKey).catch(() => { /* best-effort */ });
      }
      return originalJson(body);
    };

    // Also release the lock if the response goes out via res.send /
    // res.end without going through res.json (rare for our handlers
    // but defensive).
    res.on('finish', () => {
      if (!captured) {
        redisCache.del(lockKey).catch(() => { /* best-effort */ });
      }
    });

    next();
  };
}

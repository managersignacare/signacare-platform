/**
 * JWT Token Blacklist via Redis
 *
 * When a user logs out or a session is revoked, the JWT token ID (jti)
 * is added to a Redis blacklist. The middleware checks every request
 * against this blacklist before allowing access.
 *
 * Tokens are stored with TTL matching the JWT expiry time.
 */

import { redis } from '../config/redis';
import { config } from '../config';
import { logger } from '../utils/logger';

const BLACKLIST_PREFIX = 'jwt:blacklist:';

/**
 * Blacklist-key TTL must cover the full refresh-token lifetime so a
 * demoted user cannot refresh a NEW access token AFTER the blacklist
 * key expires (L5 Standard 3 SSoT absorption 2026-04-23). Derived from
 * config.jwt.refreshTtlDays — previously hardcoded `86400 * 7` could
 * drift silently if JWT_REFRESH_TTL_DAYS ever changed independently.
 */
function userRevokeTtlSeconds(): number {
  return config.jwt.refreshTtlDays * 86400;
}

/**
 * Add a token to the blacklist (call on logout/revocation)
 */
export async function blacklistToken(tokenId: string, expiresInSeconds: number): Promise<void> {
  try {
    await redis.set(`${BLACKLIST_PREFIX}${tokenId}`, '1', 'EX', Math.max(expiresInSeconds, 60));
  } catch (err) {
    logger.error({ err, tokenId }, 'Failed to blacklist JWT token');
  }
}

/**
 * Check if a token is blacklisted.
 *
 * BUG-442: this function does NOT swallow Redis errors. Prior to the fix
 * an internal `catch { return false }` short-circuited every caller's
 * structured `.catch(err => logger.warn({ kind: "jwt_blacklist_fail_open" }, ...))`
 * handler — the alertable log was dead code because the promise never
 * rejected. The fix lets the Redis error propagate so each caller can
 * decide whether to fail-open (authMiddleware, per OWASP ASVS 2.8.7) or
 * fail-closed, AND so the structured `kind` tag actually fires for
 * operator alerting on sustained degradation.
 */
export async function isTokenBlacklisted(tokenId: string): Promise<boolean> {
  const result = await redis.get(`${BLACKLIST_PREFIX}${tokenId}`);
  return result === '1';
}

/**
 * Blacklist all tokens for a user (force logout everywhere)
 */
export async function blacklistAllUserTokens(userId: string): Promise<void> {
  try {
    // Store a "revoke-all" timestamp — any token issued before this time is invalid
    await redis.set(`${BLACKLIST_PREFIX}user:${userId}`, Date.now().toString(), 'EX', userRevokeTtlSeconds());
  } catch (err) {
    logger.error({ err, userId }, 'Failed to blacklist all user tokens');
  }
}

/**
 * Check if a user has a "revoke-all" flag newer than the token's issued-at time.
 *
 * BUG-442: this function does NOT swallow Redis errors. See the longer
 * note on isTokenBlacklisted — same contract: let Redis errors reach
 * each caller's `.catch` so the `kind=jwt_blacklist_fail_open` structured
 * warn is observable to ops. Callers: authMiddleware,
 * scribeStreaming, and fhir/smartAuth all already have the appropriate
 * `.catch` handler; today those handlers are dead code because the
 * internal swallow never rejects. After this fix they fire on every
 * Redis outage, and operators can alert on sustained degradation.
 */
export async function isUserRevokedAfter(userId: string, issuedAt: number): Promise<boolean> {
  const revokedAt = await redis.get(`${BLACKLIST_PREFIX}user:${userId}`);
  if (!revokedAt) return false;
  return parseInt(revokedAt, 10) > issuedAt * 1000; // JWT iat is in seconds
}

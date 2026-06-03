/**
 * Session idle-timeout middleware.
 *
 * The JWT exp claim enforces a hard session lifetime (default 60
 * minutes) but does NOT enforce an inactivity window — a token
 * issued 50 minutes ago that has been silent for 49 minutes is
 * still valid for another 10 minutes. Clinical deployments expect
 * that walking away from a terminal for 15 minutes invalidates
 * the session (PRES-6 DH-3869).
 *
 * This middleware implements a Redis-backed sliding idle window
 * keyed on the staff_id. On every authenticated request:
 *
 *   - GET `idle:${staffId}` — if missing, the user has been idle
 *     longer than their effective session-idle window and every
 *     outstanding token for that user is rejected with 401
 *     SESSION_EXPIRED
 *   - If present, the value IS the per-session minutes (stored at
 *     login time so subsequent Power Settings changes apply to the
 *     NEXT session, not retroactively); EXPIRE the key with that
 *     many seconds to refresh the sliding window
 *
 * The initial key is set by authController at login time (NOT by
 * this middleware on first request) so the key-missing case
 * unambiguously means "you've been idle". Without the initial
 * write, every fresh login would be rejected.
 *
 * The per-user (not per-session) keying is deliberate:
 *   - A clinician with the desktop web AND mobile app open at the
 *     same time has ONE idle state. Activity on either device
 *     keeps all sessions fresh. "Walking away" means walking away
 *     from everything.
 *   - This matches the clinically intended behavior (if the
 *     clinician is actively using the mobile, the desktop should
 *     not silently log out).
 *
 * Fail-open semantics: if Redis is unreachable (which is a
 * separate availability issue surfaced by /ready), this middleware
 * does NOT reject the request. An audit warning is logged. The
 * rationale: the idle timeout is a defence-in-depth control, not
 * a primary authN gate — the JWT exp claim still enforces the
 * hard session lifetime. Blocking all traffic because Redis is
 * down would be a second-order incident.
 *
 * BUG-P2 — PRES-6 DH-3869 mandate of ≤15 min idle timeout. Per-
 * clinic configurable downward via `clinics.session_idle_minutes`
 * column (NULL → server default; non-null in [5, 15]). The
 * effective minutes are resolved at LOGIN time and stored in the
 * Redis value so the middleware doesn't need a per-request DB
 * lookup. Trade-off: a Power Settings change applies on next
 * login, not to already-active sessions. Documented in the close
 * note for BUG-P2.
 *
 * Env vars:
 *   SESSION_IDLE_MINUTES — server-wide default. Production: 15
 *                          (PRES-6 ceiling). Dev/test: 120 (testing
 *                          ergonomic — would require manual override
 *                          on every test that runs longer than 15 min).
 *
 * Standard satisfied: AHPRA PRES-6 (DH-3869), Australian Privacy Act
 *                     APP 11.2, ACHS Standard 1, OWASP ASVS v4 §3.3.3.
 */

import type { Request, Response, NextFunction } from 'express';
import { redis } from '../config/redis';
import { HttpError } from '../shared/errors';
import {
  isAuthChainTimeoutError,
  withAuthChainStageTimeout,
} from '../shared/authChainTimeout';
import { withTiming, type TimingEvent } from '../shared/observability/withTiming';
import { logger } from '../utils/logger';

// BUG-P2 — PRES-6 mandate: production default is now 15 (was 30).
// Dev/test stays at 120 to avoid forcing manual reconfiguration on every
// long-running test run.
const DEFAULT_IDLE_MINUTES = parseInt(
  process.env.SESSION_IDLE_MINUTES ??
    (process.env.NODE_ENV === 'production' ? '15' : '120'),
  10,
);

// PRES-6 ceiling. Clinics may TIGHTEN below this; never loosen above.
// Mirrors the DB CHECK constraint floor + ceiling on
// `clinics.session_idle_minutes`.
export const PRES6_IDLE_MINUTES_CEILING = 15;
export const PRES6_IDLE_MINUTES_FLOOR = 5;

function emitAuthChainTiming(event: TimingEvent): void {
  if (process.env.AUTH_CHAIN_PINO_TIMING !== '1') {
    return;
  }
  logger.info(
    {
      ...event,
      surface: 'auth.sessionIdle',
    },
    'A1 auth chain timing stage completed',
  );
}

/** Redis key for a user's idle sliding-window timer. */
export function idleKey(staffId: string): string {
  return `idle:${staffId}`;
}

/**
 * Resolve the effective idle-minutes for a clinic. Reads
 * `clinics.session_idle_minutes`; if NULL or out of [5, 15], falls back
 * to the env default (server-wide). Called once per login (not per
 * request).
 */
export async function effectiveIdleMinutesForClinic(clinicId: string): Promise<number> {
  try {
    const { dbAdmin } = await import('../db/db');
    const row = (await dbAdmin('clinics')
      .where({ id: clinicId })
      .select('session_idle_minutes')
      .first()) as { session_idle_minutes: number | null } | undefined;
    const m = row?.session_idle_minutes;
    if (
      typeof m === 'number'
      && Number.isInteger(m)
      && m >= PRES6_IDLE_MINUTES_FLOOR
      && m <= PRES6_IDLE_MINUTES_CEILING
    ) {
      return m;
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), clinicId },
      'effectiveIdleMinutesForClinic: DB lookup failed — using server default',
    );
  }
  // Clamp env default to PRES-6 ceiling in production. Dev/test allowed
  // to exceed for ergonomic reasons.
  if (process.env.NODE_ENV === 'production') {
    return Math.min(DEFAULT_IDLE_MINUTES, PRES6_IDLE_MINUTES_CEILING);
  }
  return DEFAULT_IDLE_MINUTES;
}

/**
 * Called by authController at login / refresh time to initialise
 * the idle sliding window for a newly-authenticated session.
 * Without this, the first authenticated request after login would
 * find no key and be rejected as idle-timed-out.
 *
 * The `minutes` parameter is the per-session effective timeout
 * (resolved via effectiveIdleMinutesForClinic). Stored as the Redis
 * value so the middleware can refresh the sliding window without a
 * per-request DB lookup. Subsequent Power Settings changes apply on
 * NEXT login.
 *
 * @param staffId — staff UUID
 * @param minutes — effective idle window in minutes (5..15 per PRES-6,
 *                  or env default in dev/test)
 */
export async function primeIdleWindow(staffId: string, minutes: number): Promise<void> {
  try {
    const seconds = minutes * 60;
    await redis.set(idleKey(staffId), String(minutes), 'EX', seconds);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), staffId, minutes },
      'primeIdleWindow: failed to set Redis idle key',
    );
  }
}

/**
 * Called on logout / session revoke to clear the idle window.
 */
export async function clearIdleWindow(staffId: string): Promise<void> {
  try {
    await redis.del(idleKey(staffId));
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), staffId },
      'clearIdleWindow: failed to delete Redis idle key',
    );
  }
}

/**
 * Express middleware. Run AFTER authMiddleware so req.user is
 * populated. Rejects the request with 401 SESSION_EXPIRED
 * when the Redis idle key has expired. On hit, refreshes the
 * sliding window using the per-session minutes stored in the
 * Redis value (BUG-P2).
 */
export function sessionIdleMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const staffId = req.user?.id;
  if (!staffId) {
    // Unauthenticated — no idle check, nothing to do. The auth
    // layer upstream should already have rejected this.
    return next();
  }

  // Fire-and-await the Redis check; fail-open on Redis errors.
  const timingBase = {
    requestId: req.requestId,
    userId: staffId,
    emit: emitAuthChainTiming,
  } as const;

  withTiming(
    'auth.session_idle.get',
    async () => withAuthChainStageTimeout(
      'auth.session_idle.get',
      redis.get(idleKey(staffId)),
    ),
    timingBase,
  )
    .then((value) => {
      if (value === null) {
        // Key expired → user has been idle too long. Reject.
        return next(
          new HttpError(
            401,
            'SESSION_EXPIRED',
            'Session idle timeout exceeded',
          ),
        );
      }
      // BUG-P2 — refresh TTL using the per-session minutes stored in the
      // value at login time. Falls back to the env default if the value
      // is malformed (legacy '1' from pre-BUG-P2 sessions).
      const parsed = parseInt(value, 10);
      const minutes = Number.isFinite(parsed) && parsed >= 1 && parsed <= 60
        ? parsed
        : DEFAULT_IDLE_MINUTES;
      const seconds = minutes * 60;
      withAuthChainStageTimeout(
        'auth.session_idle.expire',
        redis.expire(idleKey(staffId), seconds),
      )
        .catch((err) => {
          logger.warn(
            {
              err: err instanceof Error ? err.message : String(err),
              staffId,
              reason: isAuthChainTimeoutError(err) ? 'timeout' : 'upstream_error',
              stage: 'auth.session_idle.expire',
            },
            'sessionIdleMiddleware: failed to refresh Redis idle TTL (bounded-failure)',
          );
        });
      next();
    })
    .catch((err) => {
      // Fail open: Redis unreachable → log a warning and allow
      // the request to proceed. The JWT exp claim is still
      // enforcing the hard session lifetime.
      logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          staffId,
          reason: isAuthChainTimeoutError(err) ? 'timeout' : 'upstream_error',
          stage: 'auth.session_idle.get',
        },
        'sessionIdleMiddleware: Redis GET failed — allowing request (fail-open)',
      );
      next();
    });
}

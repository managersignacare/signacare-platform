/**
 * Step-up authentication for AHPRA S8 prescribing.
 *
 * BUG-P3 / PRES-7 DH-3869 + DH-4155 §3 — clinicians performing
 * S8 (Schedule 8 controlled drug) prescribing actions must complete
 * a fresh authentication challenge (MFA or password re-entry) within
 * a short window (5 minutes). The challenge is tracked via a Redis
 * key keyed on staff_id; the key is set after successful
 * verify-mfa-challenge / verify-password-challenge and must exist
 * (i.e. not yet expired) for the next S8 mutation to proceed.
 *
 * Architecture:
 *   - `markStepUpVerified(staffId)` — call after a successful challenge.
 *     Sets `stepup:${staffId}` in Redis with TTL = STEP_UP_TTL_SECONDS.
 *   - `requireRecentStepUp(auth)` — service-layer guard. Reads Redis;
 *     throws AppError(403, 'STEP_UP_REQUIRED') if missing or expired.
 *     Fail-CLOSED on Redis errors — DH-3869 prescribing-compliance
 *     mandate cannot be defeated by Redis outage; safer for clinician
 *     to re-authenticate than for an unauthenticated S8 transaction
 *     to land in the audit log.
 *
 * This is the explicit-step-up form of DH-4155 §3. It is consumed by:
 *   - prescriptionService.create (if dto.isS8 === true)
 *   - prescriptionService.cancel (if existing row.is_s8 === true)
 *   - medicationService.create (if dto.isS8 === true)
 *   - medicationService.update (if existing or new state is S8)
 *   - medicationService.cease (if existing isS8 === true)
 *
 * The 5-min window matches the BUG-P2 PRES-6 idle ceiling minus
 * typical-clinician-reaction-time so a fresh login satisfies S8
 * step-up too. Configurable via env STEP_UP_TTL_MINUTES (default 5).
 */

import { redis } from '../config/redis';
import { AppError } from './errors';
import { logger } from '../utils/logger';
import type { AuthContext } from '@signacare/shared';

const STEP_UP_TTL_MINUTES = parseInt(process.env['STEP_UP_TTL_MINUTES'] ?? '5', 10);
const STEP_UP_TTL_SECONDS = STEP_UP_TTL_MINUTES * 60;

export function stepUpKey(staffId: string): string {
  return `stepup:${staffId}`;
}

/**
 * Called by the auth challenge handlers after a successful MFA or
 * password verification. Sets the Redis key with a short TTL so the
 * next S8 mutation can proceed.
 */
export async function markStepUpVerified(staffId: string): Promise<void> {
  try {
    await redis.set(stepUpKey(staffId), '1', 'EX', STEP_UP_TTL_SECONDS);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), staffId },
      'markStepUpVerified: failed to set Redis step-up key',
    );
    // Re-throw so the challenge handler returns an error; without the
    // step-up token, the next S8 mutation would 403 anyway. Better to
    // surface the Redis failure now than to silently accept the
    // verification and reject the next clinical action.
    throw new AppError(
      'Step-up verification could not be persisted (Redis unavailable). Please retry in a moment.',
      503,
      'STEP_UP_PERSISTENCE_FAILED',
    );
  }
}

/**
 * Called from S8 mutation paths to enforce the DH-4155 §3 re-auth
 * requirement. Throws AppError(403, 'STEP_UP_REQUIRED') if the
 * caller has not completed a recent step-up challenge.
 *
 * Fail-CLOSED on Redis errors per the prescribing-compliance posture
 * — an outage of the step-up store must not silently allow S8
 * transactions to bypass the gate.
 */
export async function requireRecentStepUp(auth: AuthContext): Promise<void> {
  try {
    const value = await redis.get(stepUpKey(auth.staffId));
    if (!value) {
      throw new AppError(
        'Re-authentication required for Schedule 8 prescribing actions (PRES-7 / DH-4155). Please verify your identity and retry.',
        403,
        'STEP_UP_REQUIRED',
      );
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error(
      { err: err instanceof Error ? err.message : String(err), staffId: auth.staffId },
      'requireRecentStepUp: Redis GET failed — fail-closed for S8 prescribing compliance',
    );
    throw new AppError(
      'Step-up verification store unavailable. Please retry in a moment.',
      503,
      'STEP_UP_STORE_UNAVAILABLE',
    );
  }
}

/**
 * Called on logout — clears the step-up window so the next session
 * starts fresh. (Idle-window expiry already terminates the token; this
 * is belt-and-braces.)
 */
export async function clearStepUp(staffId: string): Promise<void> {
  try {
    await redis.del(stepUpKey(staffId));
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), staffId },
      'clearStepUp: failed to delete Redis step-up key',
    );
  }
}

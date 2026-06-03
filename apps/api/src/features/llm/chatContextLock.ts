/**
 * BUG-395 — AI chat patient-context UUID lock.
 *
 * Prevents cross-patient leakage in the /clinical-ai chat surface.
 * A clinician starting a chat with patientId=A should not be able to
 * mid-session switch to patientId=B while carrying prior prompt + RAG
 * context. Enforced via a Redis-backed conversationId → patientId
 * mapping that rejects any mismatched follow-up.
 *
 * Contract:
 *   - acquireChatPatientLock(conversationId, patientId)
 *       · First call for a new conversationId: stores the mapping + TTL.
 *       · Subsequent call with the SAME patientId: refreshes TTL.
 *       · Subsequent call with DIFFERENT patientId: returns
 *         { ok: false, lockedPatientId } — caller MUST reject request.
 *       · Redis failure: returns { ok: false, error: 'redis' } — per
 *         clinical-safety, caller MUST fail-CLOSED (block the AI call).
 *         Matches the BUG-442 jwtBlacklist fail-closed pattern.
 *   - releaseChatPatientLock(conversationId) — optional cleanup; TTL
 *     does the work normally. Swallows Redis errors (non-critical).
 *
 * TTL: 60 minutes per chat session. A single conversation UUID that
 * spans longer than 60 min will silently re-lock — acceptable.
 */

import { redis } from '../../config/redis';
import { logger } from '../../utils/logger';

export const CHAT_CTX_KEY_PREFIX = 'chat:ctx:';
// L4 absorb: sliding-idle TTL + absolute cap.
// 20 min idle: a clinician away for > 20 min without activity gets re-locked
//   (forgotten-tab safety — shift change, meeting interrupt).
// 8 hour absolute cap: even active refreshing can never exceed one shift.
//   The payload stores `createdAt`; if now - createdAt > CAP, the entry
//   is treated as expired (forced re-lock).
export const CHAT_CTX_IDLE_TTL_SEC = 20 * 60; // 20 min sliding idle
export const CHAT_CTX_ABSOLUTE_CAP_MS = 8 * 60 * 60 * 1000; // 8 hours absolute

// Legacy alias so tests that reference the old constant still compile
// — the test suite checks `CHAT_CTX_TTL_SEC` as the TTL used on SET EX.
// Keep it pointing at the idle TTL so the SET-EX path uses sliding idle.
export const CHAT_CTX_TTL_SEC = CHAT_CTX_IDLE_TTL_SEC;

export type AcquireResult =
  | { ok: true }
  | { ok: false; lockedPatientId: string; error?: never }
  | { ok: false; error: 'redis'; lockedPatientId?: never };

interface LockPayload {
  patientId: string;
  createdAt: number; // ms since epoch
}

function serialisePayload(p: LockPayload): string {
  return JSON.stringify(p);
}

function parsePayload(raw: string): LockPayload | null {
  // Legacy entries (pre-absorb) stored the bare patientId string.
  // Treat them as { patientId: raw, createdAt: now } so the absolute
  // cap begins counting from this call forward.
  if (!raw.startsWith('{')) {
    return { patientId: raw, createdAt: Date.now() };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LockPayload>;
    if (typeof parsed.patientId !== 'string' || typeof parsed.createdAt !== 'number') {
      return null;
    }
    return parsed as LockPayload;
  } catch {
    return null;
  }
}

export async function acquireChatPatientLock(
  conversationId: string,
  patientId: string,
): Promise<AcquireResult> {
  const key = `${CHAT_CTX_KEY_PREFIX}${conversationId}`;
  try {
    const existing = await redis.get(key);
    if (existing === null) {
      // First use — store the mapping with idle TTL + absolute-cap timestamp.
      const payload: LockPayload = { patientId, createdAt: Date.now() };
      await redis.set(key, serialisePayload(payload), 'EX', CHAT_CTX_IDLE_TTL_SEC);
      return { ok: true };
    }
    const parsed = parsePayload(existing);
    if (!parsed) {
      // Malformed entry — treat as expired, overwrite with fresh one.
      const payload: LockPayload = { patientId, createdAt: Date.now() };
      await redis.set(key, serialisePayload(payload), 'EX', CHAT_CTX_IDLE_TTL_SEC);
      return { ok: true };
    }
    // Absolute-cap check: the lock was created > 8h ago. Force re-lock.
    if (Date.now() - parsed.createdAt > CHAT_CTX_ABSOLUTE_CAP_MS) {
      const payload: LockPayload = { patientId, createdAt: Date.now() };
      await redis.set(key, serialisePayload(payload), 'EX', CHAT_CTX_IDLE_TTL_SEC);
      return { ok: true };
    }
    if (parsed.patientId === patientId) {
      // Same-patient continuation — refresh idle TTL but preserve
      // the original createdAt so the absolute cap still counts.
      await redis.expire(key, CHAT_CTX_IDLE_TTL_SEC);
      return { ok: true };
    }
    // DIFFERENT patientId — the clinician attempted to switch context
    // mid-conversation. Reject with the existing lock so the caller
    // can emit a structured audit + return 409 to the client.
    return { ok: false, lockedPatientId: parsed.patientId };
  } catch (err) {
    logger.error(
      { err, kind: 'chat_context_lock_redis_failed', conversationId, patientId },
      'Chat-context lock acquire failed (Redis)',
    );
    return { ok: false, error: 'redis' };
  }
}

export async function releaseChatPatientLock(conversationId: string): Promise<void> {
  const key = `${CHAT_CTX_KEY_PREFIX}${conversationId}`;
  try {
    await redis.del(key);
  } catch (err) {
    // Cleanup failure is non-critical — TTL removes the key.
    logger.warn(
      { err, kind: 'chat_context_lock_release_failed', conversationId },
      'Chat-context lock release failed (Redis) — relying on TTL',
    );
  }
}

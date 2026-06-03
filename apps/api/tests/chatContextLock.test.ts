// tests/chatContextLock.test.ts
//
// BUG-395 — AI chat patient-context UUID lock.
//
// Contract:
//   1. `acquireChatPatientLock(conversationId, patientId)` stores
//      `chat:ctx:<conversationId>` → patientId in Redis with TTL.
//   2. If no prior entry exists, returns { ok: true }.
//   3. If a prior entry matches patientId, returns { ok: true } +
//      refreshes the TTL.
//   4. If a prior entry has a DIFFERENT patientId, returns
//      { ok: false, lockedPatientId: <existing> }. Does NOT overwrite.
//   5. On Redis error, returns { ok: false, error: 'redis' } + logs
//      kind=chat_context_lock_redis_failed. Caller should treat this
//      as a hard fail (block the request) per clinical-safety policy.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/redis', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    expire: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock('../src/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

import { acquireChatPatientLock, releaseChatPatientLock, CHAT_CTX_KEY_PREFIX, CHAT_CTX_TTL_SEC } from '../src/features/llm/chatContextLock';
import { redis } from '../src/config/redis';

describe('chatContextLock — BUG-395', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acquireChatPatientLock sets the mapping when no prior entry exists', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValueOnce('OK');
    const result = await acquireChatPatientLock('conv-1', 'patient-A');
    expect(result.ok).toBe(true);
    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, payloadJson, mode, ttl] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(key).toBe(`${CHAT_CTX_KEY_PREFIX}conv-1`);
    const payload = JSON.parse(payloadJson as string);
    expect(payload.patientId).toBe('patient-A');
    expect(typeof payload.createdAt).toBe('number');
    expect(mode).toBe('EX');
    expect(ttl).toBe(CHAT_CTX_TTL_SEC);
  });

  it('acquireChatPatientLock refreshes idle TTL when the stored patientId matches', async () => {
    // Stored as the new JSON payload shape
    const stored = JSON.stringify({ patientId: 'patient-A', createdAt: Date.now() });
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(stored);
    (redis.expire as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    const result = await acquireChatPatientLock('conv-1', 'patient-A');
    expect(result.ok).toBe(true);
    expect(redis.expire).toHaveBeenCalledWith(`${CHAT_CTX_KEY_PREFIX}conv-1`, CHAT_CTX_TTL_SEC);
    // set should NOT be called on the same-patient refresh path
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('acquireChatPatientLock rejects when stored patientId differs', async () => {
    const stored = JSON.stringify({ patientId: 'patient-A', createdAt: Date.now() });
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(stored);
    const result = await acquireChatPatientLock('conv-1', 'patient-B');
    expect(result.ok).toBe(false);
    if (!result.ok && 'lockedPatientId' in result) {
      expect(result.lockedPatientId).toBe('patient-A');
    }
    // set + expire must NOT be called when rejecting
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('acquireChatPatientLock force-relocks when stored entry exceeded 8-hour absolute cap (L4 absorb)', async () => {
    // createdAt 9 hours ago → exceeds 8-hour cap → force re-lock allowed
    const stored = JSON.stringify({
      patientId: 'patient-A',
      createdAt: Date.now() - 9 * 60 * 60 * 1000,
    });
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(stored);
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValueOnce('OK');
    // Re-locking with a DIFFERENT patient should now succeed because
    // the prior lock has exceeded the absolute cap — conceptually a
    // stale shift-change lock no longer pins the clinician.
    const result = await acquireChatPatientLock('conv-1', 'patient-B');
    expect(result.ok).toBe(true);
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  it('acquireChatPatientLock treats legacy bare-string entries as fresh (migration-safe)', async () => {
    // Pre-absorb the stored value was a bare patientId string.
    // After deploy, the first-read treats it as { patientId, createdAt: now }
    // so no data migration is needed.
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce('patient-A');
    (redis.expire as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    const result = await acquireChatPatientLock('conv-1', 'patient-A');
    expect(result.ok).toBe(true);
  });

  it('acquireChatPatientLock returns { ok: false, error: "redis" } on Redis failure', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await acquireChatPatientLock('conv-1', 'patient-A');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('redis');
    }
  });

  it('releaseChatPatientLock calls Redis DEL with the prefixed key', async () => {
    (redis.del as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    await releaseChatPatientLock('conv-1');
    expect(redis.del).toHaveBeenCalledWith(`${CHAT_CTX_KEY_PREFIX}conv-1`);
  });

  it('releaseChatPatientLock swallows Redis errors (non-critical cleanup)', async () => {
    (redis.del as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));
    // Must not throw
    await expect(releaseChatPatientLock('conv-1')).resolves.toBeUndefined();
  });
});

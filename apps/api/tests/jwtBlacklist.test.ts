// tests/jwtBlacklist.test.ts
//
// BUG-442 — jwtBlacklist fail-closed on Redis error.
//
// Prior behaviour: `isTokenBlacklisted` and `isUserRevokedAfter` each
// wrapped the Redis call in `try { ... } catch { return false; }` — the
// swallow short-circuited every caller's structured `.catch` handler.
// authMiddleware's `kind=jwt_blacklist_fail_open` warn was dead code.
//
// Correct behaviour: the internal functions propagate the error; each
// caller has its own .catch that emits the structured alertable log
// AND decides whether to fail-open (authMiddleware) or fail-closed.
// This file asserts the propagation contract.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the redis module BEFORE importing the module-under-test so the
// isolated tests never hit a real Redis.
vi.mock('../src/config/redis', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

// Import AFTER the mock is in place.
import { isTokenBlacklisted, isUserRevokedAfter } from '../src/middleware/jwtBlacklist';
import { redis } from '../src/config/redis';

describe('jwtBlacklist — happy path (Redis healthy)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('isTokenBlacklisted returns true for an actively-blacklisted token', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce('1');
    await expect(isTokenBlacklisted('tok-abc')).resolves.toBe(true);
  });

  it('isTokenBlacklisted returns false when the token is not in the blacklist (null)', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await expect(isTokenBlacklisted('tok-clean')).resolves.toBe(false);
  });

  it('isUserRevokedAfter returns true when revoke-all timestamp is newer than token iat', async () => {
    // revoked 60 s ago (in ms); token iat was 120 s ago (in s, per JWT)
    const revokedAt = Date.now() - 60_000;
    const iat = Math.floor((Date.now() - 120_000) / 1000);
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(String(revokedAt));
    await expect(isUserRevokedAfter('user-123', iat)).resolves.toBe(true);
  });

  it('isUserRevokedAfter returns false when no revoke-all flag exists', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const iat = Math.floor(Date.now() / 1000);
    await expect(isUserRevokedAfter('user-clean', iat)).resolves.toBe(false);
  });

  it('isUserRevokedAfter returns false when the revoke-all timestamp is older than token iat', async () => {
    // revoked 180 s ago; token iat was 60 s ago → token was issued AFTER the revoke
    const revokedAt = Date.now() - 180_000;
    const iat = Math.floor((Date.now() - 60_000) / 1000);
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(String(revokedAt));
    await expect(isUserRevokedAfter('user-123', iat)).resolves.toBe(false);
  });
});

describe('jwtBlacklist — BUG-442 fail-closed propagation (Redis unavailable)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('isTokenBlacklisted REJECTS (does not silently return false) when Redis throws', async () => {
    const redisErr = new Error('ECONNREFUSED — redis unavailable');
    (redis.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(redisErr);
    await expect(isTokenBlacklisted('tok-xyz')).rejects.toThrow(/ECONNREFUSED/);
  });

  it('isUserRevokedAfter REJECTS (does not silently return false) when Redis throws', async () => {
    const redisErr = new Error('Connection reset by peer');
    (redis.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(redisErr);
    const iat = Math.floor(Date.now() / 1000);
    await expect(isUserRevokedAfter('user-abc', iat)).rejects.toThrow(/Connection reset/);
  });

  it('isUserRevokedAfter REJECTS the caller promise so authMiddleware .catch fires', async () => {
    // This is the critical BUG-442 assertion. Before the fix, the
    // internal try/catch swallowed the error and returned false, which
    // meant authMiddleware's `.catch(err => logger.warn({ kind:
    // "jwt_blacklist_fail_open" }, ...))` was dead code. After the fix
    // the promise rejects, letting the caller's .catch actually fire
    // and emit the alertable `kind` tag operators alert on.
    const redisErr = new Error('Redis timeout');
    (redis.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(redisErr);
    let caught: Error | null = null;
    await isUserRevokedAfter('user-x', 0).catch((err: Error) => {
      caught = err;
    });
    expect(caught).not.toBeNull();
    expect((caught as unknown as Error).message).toMatch(/timeout/);
  });
});

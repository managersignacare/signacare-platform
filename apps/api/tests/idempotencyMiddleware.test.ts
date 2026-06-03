/**
 * S1.2 — idempotencyMiddleware unit tests
 *
 * Exercises the middleware in isolation with a fake Redis client and
 * mock req/res/next so the tests can run without a live Redis instance.
 * The real production behaviour is covered by integration tests in a
 * follow-up PR; these are the spec-style verification of the algorithm.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock the redis module BEFORE importing the middleware. The middleware
// captures `redisCache` at import time so the mock must be in place
// before the first import of the SUT.
vi.mock('../src/config/redis', () => {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const fake = {
    async get(key: string): Promise<string | null> {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt > 0 && entry.expiresAt < Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(
      key: string,
      value: string,
      _modeOrEx?: string,
      ttl?: number,
      flag?: string,
    ): Promise<'OK' | null> {
      // Mimic ioredis: SET key value PX ttl NX  (S1.2 uses NX with PX)
      const isNx = flag === 'NX' || _modeOrEx === 'NX';
      if (isNx && store.has(key)) return null;
      const expiresAt = ttl ? Date.now() + ttl : 0;
      store.set(key, { value, expiresAt });
      return 'OK';
    },
    async del(key: string): Promise<number> {
      const had = store.delete(key);
      return had ? 1 : 0;
    },
    /** Test helper — clears the fake store between cases. */
    __reset() { store.clear(); },
    /** Test helper — inspect the store. */
    __dump() { return new Map(store); },
  };
  return {
    redisCache: fake,
    redis: fake,
    redisRateLimit: fake,
    connectRedis: vi.fn().mockResolvedValue(true),
  };
});

// Stub the logger so test output stays clean
vi.mock('../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { idempotencyMiddleware } from '../src/middleware/idempotencyMiddleware';
import { redisCache } from '../src/config/redis';

interface FakeResponse extends Partial<Response> {
  statusCode: number;
  body?: unknown;
  status: (code: number) => FakeResponse;
  json: (body: unknown) => FakeResponse;
  on: (event: string, cb: () => void) => FakeResponse;
}

interface ErrorBody {
  error?: string;
}

function buildRes(): FakeResponse {
  const listeners: Record<string, Array<() => void>> = {};
  const res: FakeResponse = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      // Simulate Express firing the 'finish' event after json
      (listeners.finish ?? []).forEach((cb) => cb());
      return this;
    },
    on(event: string, cb: () => void) {
      (listeners[event] ??= []).push(cb);
      return this;
    },
  };
  return res;
}

function buildReq(opts: {
  header?: string;
  clinicId?: string;
  staffId?: string;
  method?: string;
  path?: string;
}): Request {
  const headers: Record<string, string> = {};
  if (opts.header !== undefined) headers['idempotency-key'] = opts.header;
  return {
    header: (name: string) => headers[name.toLowerCase()],
    clinicId: opts.clinicId ?? 'clinic-A',
    user: { id: opts.staffId ?? 'staff-1' },
    method: opts.method ?? 'POST',
    originalUrl: opts.path ?? '/api/v1/medications',
    route: { path: opts.path ?? '/' },
  } as unknown as Request;
}

describe('idempotencyMiddleware', () => {
  beforeEach(() => {
    (redisCache as unknown as { __reset: () => void }).__reset();
  });

  it('passes through when no Idempotency-Key header is present', async () => {
    const req = buildReq({});
    const res = buildRes();
    const next = vi.fn();
    await idempotencyMiddleware()(req, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects pathologically long keys with 400', async () => {
    const req = buildReq({ header: 'x'.repeat(257) });
    const res = buildRes();
    const next = vi.fn();
    await idempotencyMiddleware()(req, res as unknown as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect((res.body as ErrorBody | undefined)?.error).toBe('idempotency_key_too_long');
  });

  it('caches the first response and returns it on replay', async () => {
    const handler = async (req: Request, res: Response, next: NextFunction) => {
      await idempotencyMiddleware()(req, res, next);
    };

    // First request
    const req1 = buildReq({ header: 'abc-123' });
    const res1 = buildRes();
    const next1 = vi.fn(() => {
      // Simulate the downstream handler responding
      res1.status(201).json({ id: 'med-1', name: 'first' });
    });
    await handler(req1, res1 as unknown as Response, next1 as NextFunction);
    // The middleware patches res.json — but our fake next runs synchronously
    // BEFORE the middleware patches it (because next is called inside the
    // mock handler, after the middleware returns). Replicate the real flow:
    // call next() THEN have the handler use res.json. We do that here:
    expect(next1).toHaveBeenCalled();
    expect(res1.statusCode).toBe(201);
    expect(res1.body).toEqual({ id: 'med-1', name: 'first' });

    // Wait one tick so the deferred cache write completes
    await new Promise((r) => setTimeout(r, 5));

    // Second request with the same key
    const req2 = buildReq({ header: 'abc-123' });
    const res2 = buildRes();
    const next2 = vi.fn();
    await idempotencyMiddleware()(req2, res2 as unknown as Response, next2 as NextFunction);

    // Replay: next must NOT be called; res must contain the cached payload
    expect(next2).not.toHaveBeenCalled();
    expect(res2.statusCode).toBe(201);
    expect(res2.body).toEqual({ id: 'med-1', name: 'first' });
  });

  it('treats the same key from different clinics as distinct operations', async () => {
    // First clinic
    const reqA = buildReq({ header: 'shared-key', clinicId: 'clinic-A' });
    const resA = buildRes();
    const nextA = vi.fn(() => { resA.status(201).json({ owner: 'A' }); });
    await idempotencyMiddleware()(reqA, resA as unknown as Response, nextA as NextFunction);
    expect(nextA).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 5));

    // Second clinic, same key — must NOT replay
    const reqB = buildReq({ header: 'shared-key', clinicId: 'clinic-B' });
    const resB = buildRes();
    const nextB = vi.fn(() => { resB.status(201).json({ owner: 'B' }); });
    await idempotencyMiddleware()(reqB, resB as unknown as Response, nextB as NextFunction);
    expect(nextB).toHaveBeenCalled();
    expect(resB.body).toEqual({ owner: 'B' });
  });

  it('returns 409 when a concurrent in-flight request holds the lock', async () => {
    // First call: middleware runs, takes the lock, but next() is NEVER
    // called and json is never reached — simulating a slow handler.
    const req1 = buildReq({ header: 'inflight-key' });
    const res1 = buildRes();
    const next1 = vi.fn();
    await idempotencyMiddleware()(req1, res1 as unknown as Response, next1 as NextFunction);
    // next was called (handler is "running") but no response yet
    expect(next1).toHaveBeenCalled();

    // Second call with the same key while the first is still in flight
    const req2 = buildReq({ header: 'inflight-key' });
    const res2 = buildRes();
    const next2 = vi.fn();
    await idempotencyMiddleware()(req2, res2 as unknown as Response, next2 as NextFunction);

    // Second must short-circuit with 409 and never call next
    expect(next2).not.toHaveBeenCalled();
    expect(res2.statusCode).toBe(409);
    expect((res2.body as ErrorBody | undefined)?.error).toBe('idempotency_key_in_use');
  });

  it('does not cache 5xx responses (so the client can retry on transient errors)', async () => {
    const req1 = buildReq({ header: 'transient-key' });
    const res1 = buildRes();
    const next1 = vi.fn(() => { res1.status(503).json({ error: 'temporarily_unavailable' }); });
    await idempotencyMiddleware()(req1, res1 as unknown as Response, next1 as NextFunction);
    expect(next1).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 5));

    // Second call with the same key — the lock has been released, the
    // 5xx was NOT cached, so we expect next to run again (the request
    // gets a fresh attempt)
    const req2 = buildReq({ header: 'transient-key' });
    const res2 = buildRes();
    const next2 = vi.fn(() => { res2.status(200).json({ ok: true }); });
    await idempotencyMiddleware()(req2, res2 as unknown as Response, next2 as NextFunction);
    expect(next2).toHaveBeenCalled();
    expect(res2.body).toEqual({ ok: true });
  });
});

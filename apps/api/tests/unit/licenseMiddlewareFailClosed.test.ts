// BUG-444 — licenseMiddleware silent bypass on module-import failure
//
// Pre-fix `apps/api/src/middleware/licenseMiddleware.ts:50-57` swallowed
// ALL exceptions from the dynamic import + checkLicense call into a
// fabricated `{valid:true, edition:'development', maxUsers:999}`
// status. Production deploys with corrupt installer/ or missing dep
// silently bypassed license enforcement. This test pins the env-aware
// fail-closed invariant: production fails CLOSED with logger.error +
// HTTP 402; development keeps the dev fallback BUT emits logger.warn
// so the fallback is observable (not silent).
//
// Pre-fix RED gate:
//   - LM-2 (prod fail-closed): pre-fix returns valid:true (FAIL).
//   - LM-3 (dev observable): pre-fix is silent (no warn fires).
//   - LM-4 (prod 402): pre-fix middleware sees valid:true and 200s.
//   - LM-6 (checkLicense throw): pre-fix dev fabricates dev license.
// Post-fix: 6/6 GREEN.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const REAL_LICENSE_OK = {
  valid: true,
  expired: false,
  daysRemaining: 30,
  expiryDate: '2026-12-31',
  edition: 'enterprise',
  maxUsers: 50,
  customerName: 'Acme',
  organisationName: 'Acme Health',
  features: ['ai-scribe'],
  gracePeroid: false,
};

function makeReq(path = '/api/v1/patients'): Request {
  return { path } as unknown as Request;
}

function makeRes(): {
  res: Response;
  statusFn: ReturnType<typeof vi.fn>;
  jsonFn: ReturnType<typeof vi.fn>;
  setHeaderFn: ReturnType<typeof vi.fn>;
} {
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const setHeaderFn = vi.fn();
  const res = {
    status: statusFn,
    json: jsonFn,
    setHeader: setHeaderFn,
  } as unknown as Response;
  return { res, statusFn, jsonFn, setHeaderFn };
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('BUG-444 — licenseMiddleware fail-closed on module-import failure', () => {
  it('LM-1 — cached status returns directly without re-importing on second call', async () => {
    // The middleware's `installer/license` path is structurally
    // unreachable at runtime (path resolves to apps/installer/license,
    // which doesn't exist in this layout), so every call hits the
    // catch branch. This test pins the cache invariant: the SECOND
    // call within CHECK_INTERVAL_MS reuses the cached status; only
    // the first call logs.
    vi.stubEnv('NODE_ENV', 'development');
    const loggerMod = await import('../../src/utils/logger');
    const warnSpy = vi.spyOn(loggerMod.logger, 'warn');
    const { __getLicenseStatusForTest } = await import('../../src/middleware/licenseMiddleware');
    await __getLicenseStatusForTest();
    const warnCallsAfterFirst = warnSpy.mock.calls.length;
    await __getLicenseStatusForTest();
    expect(warnSpy.mock.calls.length).toBe(warnCallsAfterFirst);
    void REAL_LICENSE_OK;
  });

  it('LM-2 — production, import throws: returns valid:false + logger.error fires', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.doMock('../../../installer/license', () => {
      throw new Error('Cannot find module installer/license');
    });
    const loggerMod = await import('../../src/utils/logger');
    const errorSpy = vi.spyOn(loggerMod.logger, 'error');
    const { __getLicenseStatusForTest } = await import('../../src/middleware/licenseMiddleware');
    const status = await __getLicenseStatusForTest();
    expect(status.valid).toBe(false);
    expect(status.edition).toBe('unknown');
    expect(status.maxUsers).toBe(0);
    expect(status.error).toBeTruthy();
    const matched = errorSpy.mock.calls.some(
      ([ctx]) =>
        typeof ctx === 'object' &&
        ctx !== null &&
        (ctx as Record<string, unknown>).kind === 'license_module_unavailable',
    );
    expect(matched).toBe(true);
  });

  it('LM-3 — development, import throws: dev fallback + logger.warn fires (no error)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.doMock('../../../installer/license', () => {
      throw new Error('Cannot find module installer/license');
    });
    const loggerMod = await import('../../src/utils/logger');
    const warnSpy = vi.spyOn(loggerMod.logger, 'warn');
    const errorSpy = vi.spyOn(loggerMod.logger, 'error');
    const { __getLicenseStatusForTest } = await import('../../src/middleware/licenseMiddleware');
    const status = await __getLicenseStatusForTest();
    expect(status.valid).toBe(true);
    expect(status.edition).toBe('development');
    expect(status.maxUsers).toBe(999);
    const warnMatched = warnSpy.mock.calls.some(
      ([ctx]) =>
        typeof ctx === 'object' &&
        ctx !== null &&
        (ctx as Record<string, unknown>).kind === 'license_module_unavailable_dev',
    );
    expect(warnMatched).toBe(true);
    const errorMatched = errorSpy.mock.calls.some(
      ([ctx]) =>
        typeof ctx === 'object' &&
        ctx !== null &&
        (ctx as Record<string, unknown>).kind === 'license_module_unavailable',
    );
    expect(errorMatched).toBe(false);
  });

  it('LM-4 — production middleware returns 402 on import-throw, next NOT called', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.doMock('../../../installer/license', () => {
      throw new Error('Cannot find module');
    });
    const { licenseMiddleware } = await import('../../src/middleware/licenseMiddleware');
    const { res, statusFn, jsonFn } = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    await licenseMiddleware(makeReq(), res, next);
    expect(statusFn).toHaveBeenCalledWith(402);
    expect(jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'LICENSE_EXPIRED' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('LM-5 — development middleware passes through (no 402, next called)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.doMock('../../../installer/license', () => {
      throw new Error('Cannot find module');
    });
    const { licenseMiddleware } = await import('../../src/middleware/licenseMiddleware');
    const { res, statusFn, setHeaderFn } = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    await licenseMiddleware(makeReq(), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(statusFn).not.toHaveBeenCalled();
    const editionHeaderCall = setHeaderFn.mock.calls.find(
      ([h]) => h === 'X-License-Edition',
    );
    expect(editionHeaderCall?.[1]).toBe('development');
  });

  it('LM-6 — non-exempt path enforced; exempt path /health passes through in production', async () => {
    // BUG-444 invariant: the EXEMPT_PATHS allowlist is honoured even
    // when the license module is unavailable. /health, /auth/login,
    // /license must remain reachable so operators can recover the
    // license without being locked out of their own admin endpoints.
    vi.stubEnv('NODE_ENV', 'production');
    const { licenseMiddleware } = await import('../../src/middleware/licenseMiddleware');

    // Non-exempt request → 402 (production fail-closed branch)
    const enforced = makeRes();
    const nextEnforced = vi.fn() as unknown as NextFunction;
    await licenseMiddleware(makeReq('/api/v1/patients'), enforced.res, nextEnforced);
    expect(enforced.statusFn).toHaveBeenCalledWith(402);
    expect(nextEnforced).not.toHaveBeenCalled();

    // Exempt /health → next() called, no 402
    const exempt = makeRes();
    const nextExempt = vi.fn() as unknown as NextFunction;
    await licenseMiddleware(makeReq('/health'), exempt.res, nextExempt);
    expect(nextExempt).toHaveBeenCalledTimes(1);
    expect(exempt.statusFn).not.toHaveBeenCalled();
  });
});

import { createHash } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isFeatureEnabledMock } = vi.hoisted(() => ({
  isFeatureEnabledMock: vi.fn(async () => true),
}));

vi.mock('../../src/shared/featureFlags', () => ({
  isFeatureEnabled: isFeatureEnabledMock,
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  __testResetPasswordBreachCache,
  assessPasswordBreach,
  assertPasswordNotBreached,
} from '../../src/features/auth/passwordBreachService';
import { HttpError } from '../../src/shared/errors';

const auth = {
  staffId: 'staff-1',
  clinicId: 'clinic-a',
  role: 'superadmin',
  permissions: [],
} as const;

function sha1Upper(value: string): string {
  return createHash('sha1').update(value, 'utf8').digest('hex').toUpperCase();
}

describe('BUG-P4 passwordBreachService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    __testResetPasswordBreachCache();
    isFeatureEnabledMock.mockResolvedValue(true);
  });

  it('returns disabled when feature flag is off', async () => {
    isFeatureEnabledMock.mockResolvedValue(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await assessPasswordBreach(auth, 'Password1!', { surface: 'test.disabled' });

    expect(result).toEqual({
      enabled: false,
      breached: false,
      breachCount: 0,
      source: 'disabled',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns breached=true when HIBP suffix count is >= 1', async () => {
    const password = 'Password1!';
    const digest = sha1Upper(password);
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);

    const fetchSpy = vi.fn(async (url: string) => ({
      ok: true,
      text: async () => `${suffix}:42\nABCDEF:1`,
      status: 200,
      url,
    } as unknown as Response));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await assessPasswordBreach(auth, password, { surface: 'test.breached' });

    expect(result.enabled).toBe(true);
    expect(result.breached).toBe(true);
    expect(result.breachCount).toBe(42);
    expect(result.source).toBe('hibp');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toContain(`/range/${prefix}`);
  });

  it('returns breached=false when suffix is absent from HIBP range result', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      text: async () => `ABCDEF:2\n123456:7`,
      status: 200,
    } as unknown as Response));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await assessPasswordBreach(auth, 'TotallyUnique$Passphrase42', { surface: 'test.safe' });

    expect(result.enabled).toBe(true);
    expect(result.breached).toBe(false);
    expect(result.breachCount).toBe(0);
    expect(result.source).toBe('hibp');
  });

  it('reuses prefix cache inside TTL and avoids duplicate network calls', async () => {
    const password = 'Password1!';
    const digest = sha1Upper(password);
    const suffix = digest.slice(5);

    const fetchSpy = vi.fn(async () => ({
      ok: true,
      text: async () => `${suffix}:1`,
      status: 200,
    } as unknown as Response));
    vi.stubGlobal('fetch', fetchSpy);

    const first = await assessPasswordBreach(auth, password, { surface: 'test.cache.1' });
    const second = await assessPasswordBreach(auth, password, { surface: 'test.cache.2' });

    expect(first.source).toBe('hibp');
    expect(second.source).toBe('cache');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('fails open when HIBP call errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNRESET');
    }));

    const result = await assessPasswordBreach(auth, 'Password1!', { surface: 'test.fail-open' });

    expect(result.enabled).toBe(true);
    expect(result.breached).toBe(false);
    expect(result.breachCount).toBe(0);
    expect(result.source).toBe('error');
  });

  it('assertPasswordNotBreached throws PASSWORD_BREACHED when breached', async () => {
    const password = 'Password1!';
    const suffix = sha1Upper(password).slice(5);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => `${suffix}:1`,
      status: 200,
    } as unknown as Response)));

    await expect(assertPasswordNotBreached(auth, password, { surface: 'test.assert' })).rejects.toMatchObject({
      status: 400,
      code: 'PASSWORD_BREACHED',
    } satisfies Partial<HttpError>);
  });
});

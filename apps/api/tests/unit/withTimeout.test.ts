import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/shared/errors';
import { withTimeout } from '../../src/shared/observability/withTimeout';

describe('withTimeout', () => {
  it('WTO-1: resolves the original value when the promise settles before the timeout', async () => {
    await expect(
      withTimeout(Promise.resolve('ok'), 50, 'login.lookupStaff'),
    ).resolves.toBe('ok');
  });

  it('WTO-2: rethrows the original rejection when the promise fails before the timeout', async () => {
    const boom = new Error('boom');

    await expect(
      withTimeout(Promise.reject(boom), 50, 'login.issueJwt'),
    ).rejects.toThrow(boom);
  });

  it('WTO-3: rejects with AppError(503, UPSTREAM_TIMEOUT) when the promise does not settle in time', async () => {
    const never = new Promise<never>(() => undefined);

    await expect(
      withTimeout(never, 5, 'login.auditWrite'),
    ).rejects.toMatchObject({
      message: "Upstream stage 'login.auditWrite' timed out after 5ms",
      status: 503,
      code: 'UPSTREAM_TIMEOUT',
      details: {
        stage: 'login.auditWrite',
        timeoutMs: 5,
      },
    } satisfies Partial<AppError>);
  });

  it('WTO-4: trims surrounding stage whitespace before building the timeout error', async () => {
    const never = new Promise<never>(() => undefined);

    await expect(
      withTimeout(never, 5, '  login.persistSession  '),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_TIMEOUT',
      details: {
        stage: 'login.persistSession',
        timeoutMs: 5,
      },
    } satisfies Partial<AppError>);
  });

  it('WTO-5: rejects blank stage names before racing the promise', async () => {
    await expect(
      withTimeout(Promise.resolve('ok'), 50, '   '),
    ).rejects.toThrow('withTimeout stage is required');
  });

  it('WTO-6: rejects non-positive timeout values before racing the promise', async () => {
    await expect(
      withTimeout(Promise.resolve('ok'), 0, 'login.lookupStaff'),
    ).rejects.toThrow('withTimeout timeoutMs must be > 0');

    await expect(
      withTimeout(Promise.resolve('ok'), -1, 'login.lookupStaff'),
    ).rejects.toThrow('withTimeout timeoutMs must be > 0');
  });
});

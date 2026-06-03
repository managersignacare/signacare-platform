import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/shared/errors';
import {
  isAuthChainTimeoutError,
  resolveAuthChainStageTimeoutMs,
  withAuthChainStageTimeout,
} from '../../src/shared/authChainTimeout';

const ORIGINAL_AUTH_CHAIN_STAGE_TIMEOUT_MS = process.env.AUTH_CHAIN_STAGE_TIMEOUT_MS;

afterEach(() => {
  if (ORIGINAL_AUTH_CHAIN_STAGE_TIMEOUT_MS === undefined) {
    delete process.env.AUTH_CHAIN_STAGE_TIMEOUT_MS;
  } else {
    process.env.AUTH_CHAIN_STAGE_TIMEOUT_MS = ORIGINAL_AUTH_CHAIN_STAGE_TIMEOUT_MS;
  }
});

describe('authChainTimeout', () => {
  it('ACT-1: uses default timeout when AUTH_CHAIN_STAGE_TIMEOUT_MS is unset', () => {
    delete process.env.AUTH_CHAIN_STAGE_TIMEOUT_MS;
    expect(resolveAuthChainStageTimeoutMs()).toBe(1200);
  });

  it('ACT-2: falls back to default timeout for invalid values', () => {
    process.env.AUTH_CHAIN_STAGE_TIMEOUT_MS = 'invalid';
    expect(resolveAuthChainStageTimeoutMs()).toBe(1200);

    process.env.AUTH_CHAIN_STAGE_TIMEOUT_MS = '0';
    expect(resolveAuthChainStageTimeoutMs()).toBe(1200);
  });

  it('ACT-3: clamps overly large timeout values to the hard max', () => {
    process.env.AUTH_CHAIN_STAGE_TIMEOUT_MS = '12000';
    expect(resolveAuthChainStageTimeoutMs()).toBe(10_000);
  });

  it('ACT-4: resolves value when stage promise settles before timeout', async () => {
    process.env.AUTH_CHAIN_STAGE_TIMEOUT_MS = '20';
    await expect(
      withAuthChainStageTimeout('auth.middleware.revocation_check', Promise.resolve('ok')),
    ).resolves.toBe('ok');
  });

  it('ACT-5: rejects with UPSTREAM_TIMEOUT when stage promise does not settle in time', async () => {
    process.env.AUTH_CHAIN_STAGE_TIMEOUT_MS = '5';
    const never = new Promise<never>(() => undefined);

    await expect(
      withAuthChainStageTimeout('auth.session_idle.get', never),
    ).rejects.toMatchObject({
      message: "Upstream stage 'auth.session_idle.get' timed out after 5ms",
      status: 503,
      code: 'UPSTREAM_TIMEOUT',
      details: {
        stage: 'auth.session_idle.get',
        timeoutMs: 5,
      },
    } satisfies Partial<AppError>);
  });

  it('ACT-6: identifies timeout errors by code and class', async () => {
    process.env.AUTH_CHAIN_STAGE_TIMEOUT_MS = '5';
    const never = new Promise<never>(() => undefined);
    let thrown: unknown;
    try {
      await withAuthChainStageTimeout('auth.login.session_cap.query', never);
    } catch (err) {
      thrown = err;
    }

    expect(isAuthChainTimeoutError(thrown)).toBe(true);
    expect(isAuthChainTimeoutError(new Error('not-timeout'))).toBe(false);
  });
});

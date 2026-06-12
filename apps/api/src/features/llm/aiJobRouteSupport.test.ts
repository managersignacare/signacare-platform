import { describe, expect, it } from 'vitest';
import {
  AI_JOB_QUEUE_UNAVAILABLE_CODE,
  isAiJobQueueUnavailableError,
  isAiJobStoreUnavailableError,
  toAiJobQueueSubmitError,
} from './aiJobRouteSupport';

describe('isAiJobStoreUnavailableError', () => {
  it('returns true for missing-table and missing-column postgres drift errors', () => {
    expect(
      isAiJobStoreUnavailableError(Object.assign(new Error('missing table'), { code: '42P01' })),
    ).toBe(true);
    expect(
      isAiJobStoreUnavailableError(Object.assign(new Error('missing column'), { code: '42703' })),
    ).toBe(true);
  });

  it('returns false for non-error or unrelated database failures', () => {
    expect(isAiJobStoreUnavailableError({ code: '23505' })).toBe(false);
    expect(isAiJobStoreUnavailableError(new Error('boom'))).toBe(false);
    expect(isAiJobStoreUnavailableError(null)).toBe(false);
  });
});

describe('isAiJobQueueUnavailableError', () => {
  it('returns true for Redis/network connectivity failures', () => {
    expect(
      isAiJobQueueUnavailableError(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { code: 'ECONNREFUSED' })),
    ).toBe(true);
    expect(
      isAiJobQueueUnavailableError(new Error('Connection is closed.')),
    ).toBe(true);
  });

  it('returns false for unrelated queue submit failures', () => {
    expect(isAiJobQueueUnavailableError(new Error('payload serialization failed'))).toBe(false);
    expect(isAiJobQueueUnavailableError({ code: 'VALIDATION_ERROR' })).toBe(false);
    expect(isAiJobQueueUnavailableError(null)).toBe(false);
  });
});

describe('toAiJobQueueSubmitError', () => {
  it('maps queue availability failures to a 503 app error', () => {
    const mapped = toAiJobQueueSubmitError(
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { code: 'ECONNREFUSED' }),
    );

    expect(mapped.status).toBe(503);
    expect(mapped.code).toBe(AI_JOB_QUEUE_UNAVAILABLE_CODE);
    expect(mapped.message).toContain('background AI queue');
  });

  it('keeps unexpected submit failures as the generic queue error', () => {
    const mapped = toAiJobQueueSubmitError(new Error('boom'));

    expect(mapped.status).toBe(500);
    expect(mapped.code).toBe('JOB_QUEUE_ERROR');
    expect(mapped.message).toBe('Failed to queue AI job');
  });
});

import { describe, expect, it } from 'vitest';
import {
  getAiJobQueuePriority,
  haveAiJobRetriesExhausted,
  resolveFailedAttemptNumber,
} from './aiJobRetryDiscipline';

describe('aiJobRetryDiscipline', () => {
  it('converts BullMQ attemptsMade into a human-readable failed attempt number', () => {
    expect(resolveFailedAttemptNumber(undefined)).toBe(1);
    expect(resolveFailedAttemptNumber(0)).toBe(1);
    expect(resolveFailedAttemptNumber(1)).toBe(1);
    expect(resolveFailedAttemptNumber(2)).toBe(2);
  });

  it('treats retries as exhausted only after the final allowed attempt has failed', () => {
    expect(haveAiJobRetriesExhausted({ attemptsMade: 0, maxAttempts: 2 })).toBe(false);
    expect(haveAiJobRetriesExhausted({ attemptsMade: 1, maxAttempts: 2 })).toBe(false);
    expect(haveAiJobRetriesExhausted({ attemptsMade: 2, maxAttempts: 2 })).toBe(true);
    expect(haveAiJobRetriesExhausted({ attemptsMade: 3, maxAttempts: 2 })).toBe(true);
  });

  it('prioritizes ambient recovery above long-form narrative generation', () => {
    expect(getAiJobQueuePriority('ambient-audio')).toBeLessThan(getAiJobQueuePriority('maudsley'));
    expect(getAiJobQueuePriority('letter')).toBeLessThan(getAiJobQueuePriority('formulation'));
  });
});

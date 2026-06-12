import { describe, expect, it } from 'vitest';
import { SignacareApiError } from './apiClient';
import {
  formatClinicalAiJobQueueSubmitErrorMessage,
  formatClinicalAiQueueUnavailableMessage,
  normalizeClinicalAiJobSubmitError,
} from './llmAiJobsSupport';

describe('llmAiJobsSupport', () => {
  it('formats queue-unavailable failures with actionable guidance', () => {
    expect(formatClinicalAiQueueUnavailableMessage('AI summary generation')).toBe(
      'AI summary generation is temporarily unavailable because the background AI queue cannot be reached. Retry shortly or contact your administrator if it persists.',
    );
  });

  it('formats generic queue-submit failures without overclaiming the root cause', () => {
    expect(formatClinicalAiJobQueueSubmitErrorMessage('AI discharge summary generation')).toBe(
      'AI discharge summary generation could not be queued for background processing. Retry shortly or contact your administrator if it persists.',
    );
  });

  it('normalizes API queue submit errors into clinician-readable messages', () => {
    const queueUnavailable = normalizeClinicalAiJobSubmitError(
      new SignacareApiError('Failed to queue AI job', 'AI_JOB_QUEUE_UNAVAILABLE', 503),
      'AI formulation generation',
    );
    const genericQueueError = normalizeClinicalAiJobSubmitError(
      new SignacareApiError('Failed to queue AI job', 'JOB_QUEUE_ERROR', 500),
      'AI summary generation',
    );

    expect(queueUnavailable).toBeInstanceOf(SignacareApiError);
    expect((queueUnavailable as SignacareApiError).message).toContain('background AI queue cannot be reached');
    expect((queueUnavailable as SignacareApiError).code).toBe('AI_JOB_QUEUE_UNAVAILABLE');

    expect(genericQueueError).toBeInstanceOf(SignacareApiError);
    expect((genericQueueError as SignacareApiError).message).toBe(
      'AI summary generation could not be queued for background processing. Retry shortly or contact your administrator if it persists.',
    );
    expect((genericQueueError as SignacareApiError).code).toBe('JOB_QUEUE_ERROR');
  });
});

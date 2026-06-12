import { describe, expect, it } from 'vitest';
import { SignacareApiError } from '../../../../shared/services/apiClient';
import { classifyAmbientAiJobsLoadError } from './ambientAiJobsDashboardSupport';

describe('classifyAmbientAiJobsLoadError', () => {
  it('downgrades schema drift and missing-route failures to a non-fatal recovery notice', () => {
    expect(
      classifyAmbientAiJobsLoadError(
        new SignacareApiError('schema mismatch', 'SCHEMA_MISMATCH', 503),
      ),
    ).toEqual({
      message:
        'Async scribe recovery is temporarily unavailable in this environment. Recording and note drafting can still continue in the current note.',
      severity: 'info',
    });

    expect(
      classifyAmbientAiJobsLoadError(
        new SignacareApiError('missing', 'NOT_FOUND', 404),
      ),
    ).toEqual({
      message:
        'Async scribe recovery is temporarily unavailable in this environment. Recording and note drafting can still continue in the current note.',
      severity: 'info',
    });
  });

  it('treats forbidden dashboard access as informational instead of poisoning the recorder', () => {
    expect(
      classifyAmbientAiJobsLoadError(
        new SignacareApiError('forbidden', 'MODULE_READ_DENIED', 403),
      ),
    ).toEqual({
      message: 'This account cannot open the async scribe recovery dashboard.',
      severity: 'info',
    });
  });

  it('keeps unexpected failures visible as real errors', () => {
    expect(classifyAmbientAiJobsLoadError(new Error('boom'))).toEqual({
      message: 'boom',
      severity: 'error',
    });
  });
});

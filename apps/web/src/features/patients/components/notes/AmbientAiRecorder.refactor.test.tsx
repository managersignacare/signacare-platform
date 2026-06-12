/**
 * Phase 8 UI refactor — pure-function smoke tests for the AmbientAiRecorder
 * extraction.
 *
 * apps/web vitest runs in Node env (no jsdom) per the documented React 19
 * compat decision (see apps/web/vitest.config.ts header). Hook + render
 * tests live in Playwright; here we cover the pure module surface only.
 *
 * Pure surface validated:
 *  - formatAsyncProgress — pure formatter for async ambient-job status
 *  - module surface for the three new hooks (function exports present)
 *  - module surface for the two new view components (function exports present)
 */
import { describe, expect, it } from 'vitest';
import { SignacareApiError } from '../../../../shared/services/apiClient';
import { formatAmbientValidationError, formatAsyncProgress } from './useAmbientScribeJobRunner';
import { useAmbientServiceProbe } from './useAmbientServiceProbe';
import { useAmbientRecorderController } from './useAmbientRecorderController';
import { useAmbientScribeJobRunner } from './useAmbientScribeJobRunner';
import { AmbientRecorderControls } from './AmbientRecorderControls';
import { AmbientDiagnosticsPanel } from './AmbientDiagnosticsPanel';

describe('AmbientAiRecorder refactor — formatAsyncProgress', () => {
  it('returns empty string for null status (initial / no-job state)', () => {
    expect(formatAsyncProgress(null)).toBe('');
  });

  it('formats status + numeric progress + stage on a fully-populated payload', () => {
    expect(
      formatAsyncProgress({
        jobId: 'job-1',
        action: 'medical-scribe',
        status: 'processing',
        progress: 42,
        stage: 'whisper',
      }),
    ).toBe('processing (42%) — whisper');
  });

  it('omits progress when not a number (e.g. queued before worker pickup)', () => {
    expect(
      formatAsyncProgress({
        jobId: 'job-1',
        action: 'medical-scribe',
        status: 'queued',
      }),
    ).toBe('queued');
  });

  it('omits stage when absent (matches the original Sidebar.tsx string shape)', () => {
    expect(
      formatAsyncProgress({
        jobId: 'job-1',
        action: 'medical-scribe',
        status: 'processing',
        progress: 50,
      }),
    ).toBe('processing (50%)');
  });
});

describe('AmbientAiRecorder refactor — validation error presentation', () => {
  it('surfaces the first validation field from API details instead of a generic message', () => {
    expect(
      formatAmbientValidationError(
        new SignacareApiError(
          'Request validation failed',
          'VALIDATION_ERROR',
          422,
          [{ field: 'consentId', message: 'consentId must be a valid UUID' }] as unknown as Record<string, unknown>,
        ),
      ),
    ).toBe('Ambient AI request validation failed for consentId: consentId must be a valid UUID');
  });

  it('returns null for non-validation errors', () => {
    expect(
      formatAmbientValidationError(
        new SignacareApiError('Whisper unreachable', 'WHISPER_UNREACHABLE', 503),
      ),
    ).toBeNull();
  });
});

describe('AmbientAiRecorder refactor — extracted module surface', () => {
  it('exports useAmbientServiceProbe as a function', () => {
    expect(typeof useAmbientServiceProbe).toBe('function');
  });

  it('exports useAmbientRecorderController as a function', () => {
    expect(typeof useAmbientRecorderController).toBe('function');
  });

  it('exports useAmbientScribeJobRunner as a function', () => {
    expect(typeof useAmbientScribeJobRunner).toBe('function');
  });

  it('exports AmbientRecorderControls as a function', () => {
    expect(typeof AmbientRecorderControls).toBe('function');
  });

  it('exports AmbientDiagnosticsPanel as a function', () => {
    expect(typeof AmbientDiagnosticsPanel).toBe('function');
  });
});

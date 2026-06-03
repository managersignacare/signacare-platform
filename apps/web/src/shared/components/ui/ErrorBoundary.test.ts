import { describe, expect, it } from 'vitest';
import { resolveErrorBoundaryMessage } from './ErrorBoundary';

describe('resolveErrorBoundaryMessage', () => {
  it('returns safe generic message when no error is available', () => {
    expect(
      resolveErrorBoundaryMessage(null, { allowRawDetails: false }),
    ).toBe('An unexpected error occurred in this section. Please try again.');
  });

  it('returns safe generic message when raw details are disabled', () => {
    expect(
      resolveErrorBoundaryMessage(new Error('DB connection refused at host x'), { allowRawDetails: false }),
    ).toBe('An unexpected error occurred in this section. Please try again.');
  });

  it('returns raw error message when raw details are enabled', () => {
    expect(
      resolveErrorBoundaryMessage(new Error('Cannot read properties of undefined'), { allowRawDetails: true }),
    ).toBe('Cannot read properties of undefined');
  });

  it('falls back to safe message for blank raw message', () => {
    expect(
      resolveErrorBoundaryMessage(new Error('   '), { allowRawDetails: true }),
    ).toBe('An unexpected error occurred in this section. Please try again.');
  });
});

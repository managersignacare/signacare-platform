import { describe, expect, it } from 'vitest';
import { getErxAwareErrorMessage } from './erxErrorMessage';

describe('BUG-335 ERX_NOT_CONFIGURED frontend branching', () => {
  it('returns HPIO-specific setup guidance when backend reports clinics.hpio', () => {
    const message = getErxAwareErrorMessage(
      {
        response: {
          data: {
            code: 'ERX_NOT_CONFIGURED',
            details: { field: 'clinics.hpio' },
          },
        },
      },
      'fallback',
    );

    expect(message).toContain('clinic HPI-O is missing or invalid');
    expect(message).toContain('Org Settings -> eRx Setup');
  });

  it('returns NPDS-specific setup guidance when backend reports clinics.npds_conformance_id', () => {
    const message = getErxAwareErrorMessage(
      {
        response: {
          data: {
            code: 'ERX_NOT_CONFIGURED',
            details: { field: 'clinics.npds_conformance_id' },
          },
        },
      },
      'fallback',
    );

    expect(message).toContain('clinic NPDS Conformance ID is missing');
    expect(message).toContain('Org Settings -> eRx Setup');
  });

  it('falls back to backend error text for non-ERX_NOT_CONFIGURED errors', () => {
    const message = getErxAwareErrorMessage(
      {
        response: {
          data: {
            code: 'SOME_OTHER_CODE',
            error: 'Other backend failure',
          },
        },
      },
      'fallback',
    );

    expect(message).toBe('Other backend failure');
  });

  it('falls back to caller fallback when no structured message exists', () => {
    const message = getErxAwareErrorMessage({}, 'fallback');
    expect(message).toBe('fallback');
  });
});


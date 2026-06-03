import { describe, expect, it } from 'vitest';
import {
  hasRecentRiskAssessment,
  resolveRiskAssessmentCompletionTime,
} from './recentRiskAssessment';

describe('recentRiskAssessment', () => {
  it('uses createdAt when present', () => {
    const resolved = resolveRiskAssessmentCompletionTime({
      createdAt: '2026-05-12T08:00:00.000Z',
      assessmentDate: '2026-05-01',
    });

    expect(resolved?.toISOString()).toBe('2026-05-12T08:00:00.000Z');
  });

  it('falls back to end-of-day assessmentDate when createdAt is absent', () => {
    const resolved = resolveRiskAssessmentCompletionTime({
      assessmentDate: '2026-05-12',
    });

    expect(resolved?.toISOString()).toBe('2026-05-12T23:59:59.999Z');
  });

  it('returns false when there are no parseable assessments', () => {
    const ok = hasRecentRiskAssessment(
      [{ createdAt: 'not-a-date', assessmentDate: 'not-a-date' }],
      new Date('2026-05-12T12:00:00.000Z'),
    );

    expect(ok).toBe(false);
  });

  it('accepts an assessment inside 48 hours', () => {
    const ok = hasRecentRiskAssessment(
      [{ createdAt: '2026-05-11T06:30:00.000Z' }],
      new Date('2026-05-12T08:00:00.000Z'),
    );

    expect(ok).toBe(true);
  });

  it('rejects an assessment older than 48 hours', () => {
    const ok = hasRecentRiskAssessment(
      [{ createdAt: '2026-05-09T07:59:59.000Z' }],
      new Date('2026-05-12T08:00:00.000Z'),
    );

    expect(ok).toBe(false);
  });
});

/**
 * Tests for the measurement visual helpers (pure functions).
 *
 * Coverage focus (operator brief):
 *   - Family labels are consistent across surfaces.
 *   - Trend direction tone maps correctly (improved=positive, etc.).
 *   - Stale detection uses 90 days.
 *   - sortSeriesByRecency keeps newest first.
 */
import { describe, expect, it } from 'vitest';
import type { MeasurementSeries } from '@signacare/shared';
import {
  describeMeasurementFamily,
  describeMeasurementProvenance,
  describeRelativeAge,
  describeTrendDirection,
  isMeasurementStale,
  sortSeriesByRecency,
} from './measurementVisualHelpers';

describe('describeMeasurementFamily', () => {
  it('uses operator-brief headings', () => {
    expect(describeMeasurementFamily('outcome_measure')).toBe('Outcome Measures');
    expect(describeMeasurementFamily('clinician_rating_scale')).toBe('Clinician-Rated Rating Scales');
    expect(describeMeasurementFamily('self_rated_scale')).toBe('Viva Self-Rated Measures');
  });
});

describe('describeMeasurementProvenance', () => {
  it('labels the patient self-rated source as Viva (operator brief: never as clinician-rated)', () => {
    expect(describeMeasurementProvenance('viva_patient_app')).toBe('Patient — Viva app');
  });
  it('labels clinician notes as clinician rating scale', () => {
    expect(describeMeasurementProvenance('clinical_note_rating_scale')).toBe('Clinician — rating scale');
  });
  it('labels NOCC outcomes as Clinician NOCC outcome', () => {
    expect(describeMeasurementProvenance('outcome_measure')).toBe('Clinician — NOCC outcome');
  });
});

describe('describeTrendDirection', () => {
  it('marks improved as positive with down arrow (lower-is-better default)', () => {
    expect(describeTrendDirection('improved')).toEqual({
      label: 'Improved',
      tone: 'positive',
      arrow: '↓',
    });
  });
  it('marks worsened as negative with up arrow', () => {
    expect(describeTrendDirection('worsened')).toEqual({
      label: 'Worsened',
      tone: 'negative',
      arrow: '↑',
    });
  });
  it('marks stable as neutral', () => {
    expect(describeTrendDirection('stable').tone).toBe('neutral');
  });
  it('marks insufficient_data as unknown', () => {
    expect(describeTrendDirection('insufficient_data').tone).toBe('unknown');
  });
});

describe('describeRelativeAge', () => {
  const now = new Date('2026-06-06T00:00:00.000Z');
  it('reports today for same-day', () => {
    expect(describeRelativeAge('2026-06-06T00:00:00.000Z', now)).toBe('today');
  });
  it('reports yesterday for 1 day ago', () => {
    expect(describeRelativeAge('2026-06-05T00:00:00.000Z', now)).toBe('yesterday');
  });
  it('reports days for < 30 days', () => {
    expect(describeRelativeAge('2026-05-20T00:00:00.000Z', now)).toMatch(/^\d+ days ago$/);
  });
  it('reports months for < 365 days', () => {
    expect(describeRelativeAge('2026-01-01T00:00:00.000Z', now)).toMatch(/months ago/);
  });
  it('returns empty string on missing input', () => {
    expect(describeRelativeAge('', now)).toBe('');
  });
});

describe('isMeasurementStale', () => {
  const now = new Date('2026-06-06T00:00:00.000Z');
  it('marks scores > 90 days old as stale', () => {
    expect(isMeasurementStale('2026-02-01T00:00:00.000Z', now)).toBe(true);
  });
  it('does not mark recent scores as stale', () => {
    expect(isMeasurementStale('2026-05-15T00:00:00.000Z', now)).toBe(false);
  });
});

describe('sortSeriesByRecency', () => {
  function s(slug: string, completedAt: string): MeasurementSeries {
    return {
      instrumentSlug: slug,
      displayName: slug,
      family: 'outcome_measure',
      raterType: 'clinician',
      source: 'outcome_measure',
      points: [],
      latestPoint: {
        id: 'p',
        patientId: '00000000-0000-4000-8000-000000000001',
        episodeId: null,
        instrumentSlug: slug,
        instrumentDisplayName: slug,
        family: 'outcome_measure',
        raterType: 'clinician',
        source: 'outcome_measure',
        rawScore: 10,
        maxScore: 50,
        minScore: 10,
        severityLabel: null,
        severityColor: null,
        completedAt,
        collectionOccasion: null,
        completedByStaffId: null,
        completedByStaffName: null,
        submittedByPatient: false,
      },
      trendSummary: {
        direction: 'insufficient_data',
        rawDelta: null,
        spanDays: null,
        administrations: 1,
        polarity: 'higher_is_worse',
      },
      clinicalInterpretationHint: null,
    };
  }
  it('places the most recently-completed series first', () => {
    const older = s('a', '2026-01-01T00:00:00.000Z');
    const newer = s('b', '2026-05-01T00:00:00.000Z');
    const sorted = [older, newer].sort(sortSeriesByRecency);
    expect(sorted[0].instrumentSlug).toBe('b');
    expect(sorted[1].instrumentSlug).toBe('a');
  });
});

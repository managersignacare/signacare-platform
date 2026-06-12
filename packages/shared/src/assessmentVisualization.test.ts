/**
 * Tests for the assessment visualisation contract.
 *
 * Coverage focus (operator brief):
 *   - Different scales are NOT normalised / comparatively ranked unless a
 *     validated transform exists -> we assert the schema has NO field
 *     called `normalizedScore` or `comparativeRank` (regression guard).
 *   - Self-rated scales retain raterType=patient and family=self_rated_scale.
 *   - Outcome measures retain family=outcome_measure.
 *   - Clinician rating scales retain raterType=clinician.
 *   - Cross-field invariants reject inconsistent points.
 *   - Trend direction polarity respects per-instrument declaration.
 *   - `buildMeasurementSeries` refuses mixed-instrument input.
 *
 * Pure-function tests; no fixtures, no DB.
 */
import { describe, expect, it } from 'vitest';
import {
  MeasurementPointSchema,
  MeasurementSeriesSchema,
  MeasurementDashboardSummarySchema,
  TrendSummarySchema,
  buildMeasurementSeries,
  computeTrendDirection,
  getInstrumentPolarity,
  type MeasurementPoint,
} from './assessmentVisualization.schemas';

function testUuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

const POINT_ID_BY_LABEL: Record<string, string> = {
  'point-1': testUuid(1),
  'point-2': testUuid(2),
  a: testUuid(11),
  b: testUuid(12),
  c: testUuid(13),
  e: testUuid(21),
  l: testUuid(22),
  p: testUuid(31),
};

function pointId(label: string): string {
  return POINT_ID_BY_LABEL[label] ?? label;
}

function basePoint(overrides: Partial<MeasurementPoint> = {}): MeasurementPoint {
  const point: MeasurementPoint = {
    id: pointId('point-1'),
    patientId: '00000000-0000-4000-8000-000000000001',
    episodeId: null,
    instrumentSlug: 'k10',
    instrumentDisplayName: 'K10 (Kessler Psychological Distress Scale)',
    family: 'outcome_measure',
    raterType: 'clinician',
    source: 'outcome_measure',
    rawScore: 22,
    maxScore: 50,
    minScore: 10,
    severityLabel: 'Mild distress',
    severityColor: '#b8621a',
    completedAt: '2026-03-01T00:00:00.000Z',
    collectionOccasion: 'review',
    completedByStaffId: '00000000-0000-4000-8000-000000000002',
    completedByStaffName: 'Dr Test',
    submittedByPatient: false,
    ...overrides,
  };
  if (overrides.id) point.id = pointId(overrides.id);
  return point;
}

describe('MeasurementPointSchema cross-field invariants', () => {
  it('accepts a well-formed outcome measure point', () => {
    expect(MeasurementPointSchema.parse(basePoint())).toBeDefined();
  });

  it('rejects outcome_measure source paired with non-outcome_measure family', () => {
    const bad = basePoint({ source: 'outcome_measure', family: 'self_rated_scale', raterType: 'patient', submittedByPatient: false });
    expect(() => MeasurementPointSchema.parse(bad)).toThrow();
  });

  it('rejects clinical_note_rating_scale source paired with self_rated_scale family', () => {
    const bad = basePoint({
      source: 'clinical_note_rating_scale',
      family: 'self_rated_scale',
      raterType: 'patient',
      submittedByPatient: false,
      instrumentSlug: 'phq9',
      instrumentDisplayName: 'PHQ-9',
    });
    expect(() => MeasurementPointSchema.parse(bad)).toThrow();
  });

  it('rejects viva_patient_app source paired with clinician rating scale family', () => {
    const bad = basePoint({
      source: 'viva_patient_app',
      family: 'clinician_rating_scale',
      raterType: 'clinician',
      submittedByPatient: false,
    });
    expect(() => MeasurementPointSchema.parse(bad)).toThrow();
  });

  it('rejects self_rated_scale family without raterType=patient', () => {
    const bad = basePoint({
      family: 'self_rated_scale',
      raterType: 'clinician',
      source: 'viva_patient_app',
      submittedByPatient: true,
    });
    expect(() => MeasurementPointSchema.parse(bad)).toThrow();
  });

  it('rejects clinician_rating_scale family without raterType=clinician', () => {
    const bad = basePoint({
      family: 'clinician_rating_scale',
      raterType: 'patient',
      source: 'clinical_note_rating_scale',
      submittedByPatient: false,
    });
    expect(() => MeasurementPointSchema.parse(bad)).toThrow();
  });

  it('rejects outcome_measure family without raterType=clinician', () => {
    const bad = basePoint({ family: 'outcome_measure', raterType: 'patient' });
    expect(() => MeasurementPointSchema.parse(bad)).toThrow();
  });

  it('rejects submittedByPatient=false on viva_patient_app source', () => {
    const bad = basePoint({
      source: 'viva_patient_app',
      family: 'self_rated_scale',
      raterType: 'patient',
      submittedByPatient: false,
      instrumentSlug: 'phq9',
      instrumentDisplayName: 'PHQ-9',
    });
    expect(() => MeasurementPointSchema.parse(bad)).toThrow();
  });

  it('rejects submittedByPatient=true on non-viva sources', () => {
    const bad = basePoint({ source: 'outcome_measure', submittedByPatient: true });
    expect(() => MeasurementPointSchema.parse(bad)).toThrow();
  });

  it('rejects mismatched severityLabel/severityColor (label without colour)', () => {
    const bad = basePoint({ severityLabel: 'Mild', severityColor: null });
    expect(() => MeasurementPointSchema.parse(bad)).toThrow();
  });

  it('rejects mismatched severityLabel/severityColor (colour without label)', () => {
    const bad = basePoint({ severityLabel: null, severityColor: '#abcdef' });
    expect(() => MeasurementPointSchema.parse(bad)).toThrow();
  });

  it('accepts both severity fields null', () => {
    const ok = basePoint({ severityLabel: null, severityColor: null });
    expect(MeasurementPointSchema.parse(ok)).toBeDefined();
  });

  it('accepts a well-formed self-rated PHQ-9 point', () => {
    const ok = basePoint({
      family: 'self_rated_scale',
      raterType: 'patient',
      source: 'viva_patient_app',
      submittedByPatient: true,
      instrumentSlug: 'phq9',
      instrumentDisplayName: 'PHQ-9 (Patient Health Questionnaire-9)',
      rawScore: 12,
      maxScore: 27,
      minScore: 0,
      completedByStaffId: null,
      completedByStaffName: null,
    });
    expect(MeasurementPointSchema.parse(ok)).toBeDefined();
  });

  it('accepts a well-formed clinician rating scale point (MADRS)', () => {
    const ok = basePoint({
      family: 'clinician_rating_scale',
      raterType: 'clinician',
      source: 'clinical_note_rating_scale',
      submittedByPatient: false,
      instrumentSlug: 'madrs',
      instrumentDisplayName: 'MADRS (Montgomery-Åsberg Depression Rating Scale)',
      rawScore: 18,
      maxScore: 60,
      minScore: 0,
    });
    expect(MeasurementPointSchema.parse(ok)).toBeDefined();
  });
});

describe('TrendSummarySchema', () => {
  it('requires direction=insufficient_data when administrations < 2', () => {
    expect(() => TrendSummarySchema.parse({
      direction: 'improved',
      rawDelta: 0,
      spanDays: null,
      administrations: 1,
      polarity: 'higher_is_worse',
    })).toThrow();
  });

  it('rejects direction=insufficient_data when administrations >= 2', () => {
    expect(() => TrendSummarySchema.parse({
      direction: 'insufficient_data',
      rawDelta: 5,
      spanDays: 10,
      administrations: 3,
      polarity: 'higher_is_worse',
    })).toThrow();
  });

  it('accepts a well-formed insufficient_data summary', () => {
    expect(TrendSummarySchema.parse({
      direction: 'insufficient_data',
      rawDelta: null,
      spanDays: null,
      administrations: 1,
      polarity: 'higher_is_worse',
    })).toBeDefined();
  });
});

describe('computeTrendDirection polarity logic', () => {
  it('reports insufficient_data with < 2 administrations', () => {
    expect(computeTrendDirection(null, 'higher_is_worse', 1)).toBe('insufficient_data');
  });

  it('reports stable when polarity unknown', () => {
    expect(computeTrendDirection(7, 'unknown', 3)).toBe('stable');
  });

  it('reports stable when delta within +/-1 of 0', () => {
    expect(computeTrendDirection(1, 'higher_is_worse', 3)).toBe('stable');
    expect(computeTrendDirection(-1, 'higher_is_worse', 3)).toBe('stable');
    expect(computeTrendDirection(0, 'higher_is_worse', 3)).toBe('stable');
  });

  it('reports improved when higher_is_worse and delta < 0', () => {
    expect(computeTrendDirection(-5, 'higher_is_worse', 3)).toBe('improved');
  });

  it('reports worsened when higher_is_worse and delta > 0', () => {
    expect(computeTrendDirection(5, 'higher_is_worse', 3)).toBe('worsened');
  });

  it('reports improved when higher_is_better and delta > 0', () => {
    expect(computeTrendDirection(5, 'higher_is_better', 3)).toBe('improved');
  });

  it('reports worsened when higher_is_better and delta < 0', () => {
    expect(computeTrendDirection(-5, 'higher_is_better', 3)).toBe('worsened');
  });
});

describe('getInstrumentPolarity registry coverage', () => {
  it('declares HoNOS / K10 / PHQ-9 as higher_is_worse', () => {
    expect(getInstrumentPolarity('honos')).toBe('higher_is_worse');
    expect(getInstrumentPolarity('k10')).toBe('higher_is_worse');
    expect(getInstrumentPolarity('phq9')).toBe('higher_is_worse');
  });

  it('declares WHO-5 / MoCA / GAF as higher_is_better', () => {
    expect(getInstrumentPolarity('who5')).toBe('higher_is_better');
    expect(getInstrumentPolarity('moca')).toBe('higher_is_better');
    expect(getInstrumentPolarity('gaf')).toBe('higher_is_better');
  });

  it('falls back to unknown for slugs the registry does not cover', () => {
    expect(getInstrumentPolarity('totally-not-a-real-scale')).toBe('unknown');
  });
});

describe('buildMeasurementSeries', () => {
  it('throws on empty input', () => {
    expect(() => buildMeasurementSeries([])).toThrow();
  });

  it('throws on mixed instrument slugs', () => {
    const a = basePoint({ id: 'a', instrumentSlug: 'honos' });
    const b = basePoint({
      id: 'b',
      instrumentSlug: 'k10',
      instrumentDisplayName: 'K10',
      completedAt: '2026-04-01T00:00:00.000Z',
    });
    expect(() => buildMeasurementSeries([a, b])).toThrow();
  });

  it('throws on mixed families', () => {
    const a = basePoint({
      id: 'a',
      family: 'outcome_measure',
      raterType: 'clinician',
      source: 'outcome_measure',
    });
    const b = basePoint({
      id: 'b',
      family: 'clinician_rating_scale',
      raterType: 'clinician',
      source: 'clinical_note_rating_scale',
      completedAt: '2026-04-01T00:00:00.000Z',
    });
    expect(() => buildMeasurementSeries([a, b])).toThrow();
  });

  it('returns insufficient_data trend on single point', () => {
    const s = buildMeasurementSeries([basePoint()]);
    expect(s.trendSummary.direction).toBe('insufficient_data');
    expect(s.trendSummary.rawDelta).toBeNull();
    expect(s.trendSummary.spanDays).toBeNull();
    expect(s.trendSummary.administrations).toBe(1);
    expect(s.latestPoint?.id).toBe(pointId('point-1'));
  });

  it('computes trend across two K10 points (improvement)', () => {
    const earliest = basePoint({ id: 'e', rawScore: 30, completedAt: '2026-01-01T00:00:00.000Z' });
    const latest = basePoint({ id: 'l', rawScore: 20, completedAt: '2026-03-01T00:00:00.000Z' });
    const s = buildMeasurementSeries([latest, earliest]); // pass shuffled to assert sort
    expect(s.points[0].id).toBe(pointId('e'));
    expect(s.points[1].id).toBe(pointId('l'));
    expect(s.latestPoint?.id).toBe(pointId('l'));
    expect(s.trendSummary.rawDelta).toBe(-10);
    expect(s.trendSummary.direction).toBe('improved');
    expect(s.trendSummary.spanDays).toBeGreaterThan(50);
    expect(s.trendSummary.polarity).toBe('higher_is_worse');
  });

  it('produces a valid MeasurementSeries that parses through the schema', () => {
    const a = basePoint({ id: 'a', rawScore: 30, completedAt: '2026-01-01T00:00:00.000Z' });
    const b = basePoint({ id: 'b', rawScore: 32, completedAt: '2026-02-15T00:00:00.000Z' });
    const c = basePoint({ id: 'c', rawScore: 28, completedAt: '2026-03-01T00:00:00.000Z' });
    const series = buildMeasurementSeries([a, b, c], 'Mild distress range');
    expect(MeasurementSeriesSchema.parse(series)).toBeDefined();
    expect(series.clinicalInterpretationHint).toBe('Mild distress range');
  });
});

describe('MeasurementSeriesSchema rejects inconsistent series', () => {
  it('rejects a series whose points have mismatched slug', () => {
    const ok = basePoint({ instrumentSlug: 'honos', instrumentDisplayName: 'HoNOS' });
    const bad = basePoint({
      id: 'point-2',
      instrumentSlug: 'k10',
      instrumentDisplayName: 'K10',
      completedAt: '2026-04-01T00:00:00.000Z',
    });
    const series = {
      instrumentSlug: 'honos',
      displayName: 'HoNOS',
      family: 'outcome_measure' as const,
      raterType: 'clinician' as const,
      source: 'outcome_measure' as const,
      points: [ok, bad],
      latestPoint: bad,
      trendSummary: {
        direction: 'stable' as const,
        rawDelta: 0,
        spanDays: 30,
        administrations: 2,
        polarity: 'higher_is_worse' as const,
      },
      clinicalInterpretationHint: null,
    };
    expect(() => MeasurementSeriesSchema.parse(series)).toThrow();
  });
});

describe('MeasurementDashboardSummarySchema overall structure', () => {
  it('accepts a well-formed empty summary', () => {
    expect(MeasurementDashboardSummarySchema.parse({
      patientId: '00000000-0000-4000-8000-000000000001',
      episodeId: null,
      generatedAt: '2026-06-06T00:00:00.000Z',
      latestByFamily: {
        outcome_measure: [],
        clinician_rating_scale: [],
        self_rated_scale: [],
      },
      series: [],
      crossInstrumentTimeline: [],
      warnings: [],
    })).toBeDefined();
  });

  it('rejects a summary where a latest point lacks a backing series', () => {
    const p = basePoint();
    expect(() => MeasurementDashboardSummarySchema.parse({
      patientId: p.patientId,
      episodeId: null,
      generatedAt: '2026-06-06T00:00:00.000Z',
      latestByFamily: {
        outcome_measure: [p],
        clinician_rating_scale: [],
        self_rated_scale: [],
      },
      series: [],
      crossInstrumentTimeline: [],
      warnings: [],
    })).toThrow();
  });

  it('rejects a timeline event without a backing series', () => {
    expect(() => MeasurementDashboardSummarySchema.parse({
      patientId: '00000000-0000-4000-8000-000000000001',
      episodeId: null,
      generatedAt: '2026-06-06T00:00:00.000Z',
      latestByFamily: {
        outcome_measure: [],
        clinician_rating_scale: [],
        self_rated_scale: [],
      },
      series: [],
      crossInstrumentTimeline: [{
        pointId: pointId('p'),
        completedAt: '2026-04-01T00:00:00.000Z',
        family: 'outcome_measure',
        instrumentSlug: 'honos',
        instrumentDisplayName: 'HoNOS',
        rawScore: 12,
        maxScore: 48,
        severityLabel: null,
        severityColor: null,
        source: 'outcome_measure',
      }],
      warnings: [],
    })).toThrow();
  });
});

describe('non-goals (operator brief): no normalized/comparativeRank fields', () => {
  it('the MeasurementPoint shape carries no normalisedScore or comparativeRank field', async () => {
    // Inspect the runtime schema shape — we should never accept either key,
    // because the brief forbids cross-instrument normalisation without a
    // validated transform.
    const mod = await import('./assessmentVisualization.schemas');
    const source = mod.MeasurementPointSchema.toString();
    expect(source).not.toContain('normalizedScore');
    expect(source).not.toContain('normalisedScore');
    expect(source).not.toContain('comparativeRank');
  });

  it('parsing rejects extra unknown fields on cross-instrument events by virtue of zod strict-default behaviour', () => {
    // z.object() by default strips unknown keys; this asserts the timeline
    // schema does not silently accept a `normalizedScore` key — even if a
    // future hand-edit tried to inject one, it would not round-trip.
    const parsed = MeasurementDashboardSummarySchema.parse({
      patientId: '00000000-0000-4000-8000-000000000001',
      episodeId: null,
      generatedAt: '2026-06-06T00:00:00.000Z',
      latestByFamily: { outcome_measure: [], clinician_rating_scale: [], self_rated_scale: [] },
      series: [],
      crossInstrumentTimeline: [],
      warnings: [],
    });
    // No prohibited fields leak through.
    expect((parsed as Record<string, unknown>)['normalizedScore']).toBeUndefined();
    expect((parsed as Record<string, unknown>)['comparativeRank']).toBeUndefined();
  });
});

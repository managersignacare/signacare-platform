/**
 * Unit tests for the measurement-summary aggregation service.
 *
 * Coverage focus (operator brief):
 *   - Outcome graph excludes assigned_for_patient Viva rows.
 *   - Clinician rating summary excludes patient self-rated rows.
 *   - Viva summary includes self-rated scorable patient-app rows.
 *   - Multiple instruments return separate series, not one merged line.
 *   - Unsupported instruments are warned/excluded, not silently rendered.
 *
 * Uses a minimal mock Knex-like fluent builder so the service is exercised
 * without a real database. The brief permits this — the contract under
 * test is the aggregation/classification logic, not the SQL execution.
 */
import { describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import {
  MeasurementDashboardSummarySchema,
  resolveScaleByTemplateName,
} from '@signacare/shared';
import { buildMeasurementSummaryForPatient } from '../../src/features/assessments/measurementSummaryService';

interface OmRow {
  id: string;
  patient_id: string;
  clinic_id: string;
  episode_id: string | null;
  measure_type: string;
  template_name: string | null;
  collection_occasion: string | null;
  total_score: number | null;
  created_at: string;
  completed_at: string | null;
  staff_id: string | null;
  assigned_for_patient: boolean | null;
  status: string | null;
  deleted_at: string | null;
}

interface CnRow {
  id: string;
  patient_id: string;
  clinic_id: string;
  episode_id: string | null;
  note_type: string;
  status: string;
  deleted_at: string | null;
  contact_meta: unknown;
  signed_by_id: string | null;
  signed_at: string | null;
  created_at: string;
}

interface StaffRow {
  id: string;
  clinic_id: string;
  given_name: string | null;
  family_name: string | null;
}

interface Fixture {
  outcomeMeasures: OmRow[];
  clinicalNotes: CnRow[];
  staff: StaffRow[];
}

/**
 * Minimal mock that supports the chain shapes the service uses:
 *   db('table').where(...).where(...).whereNotNull(...).orderBy(...).select(...)
 *   db('table').whereIn(...).where(...).select(...)
 *   db('table').where(...).whereIn(...).where(...).whereNull(...).whereNotNull(...).orderBy(...).select(...)
 *
 * It defers filtering until the .select() call is awaited.
 */
function mockKnex(fixture: Fixture): Knex {
  function builderFor(table: string): unknown {
    // Predicate accumulator; lazily applied at await-time.
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    let dataset: Record<string, unknown>[] = [];
    if (table === 'outcome_measures') dataset = fixture.outcomeMeasures as unknown as Record<string, unknown>[];
    else if (table === 'clinical_notes') dataset = fixture.clinicalNotes as unknown as Record<string, unknown>[];
    else if (table === 'staff') dataset = fixture.staff as unknown as Record<string, unknown>[];
    let orderField: string | null = null;
    let orderDir: 'asc' | 'desc' = 'asc';

    const builder: Record<string, (...args: unknown[]) => unknown> = {};
    builder.where = (...args: unknown[]) => {
      if (typeof args[0] === 'function') {
        // .where((b) => { b.where(...).orWhereNull(...) }) — collect into nested filter.
        const groupFilters: Array<(row: Record<string, unknown>) => boolean> = [];
        const nestedBuilder = {
          where: (next: unknown) => {
            if (next && typeof next === 'object') {
              for (const [k, v] of Object.entries(next as Record<string, unknown>)) {
                groupFilters.push((row) => row[k] === v);
              }
            }
            return nestedBuilder;
          },
          orWhereNull: (col: unknown) => {
            // Tag this group as OR with the existing matchers.
            const prior = groupFilters.splice(0, groupFilters.length);
            groupFilters.push((row) =>
              prior.every((f) => f(row)) || row[String(col)] === null || row[String(col)] === undefined,
            );
            return nestedBuilder;
          },
        };
        (args[0] as (b: typeof nestedBuilder) => void)(nestedBuilder);
        filters.push((row) => groupFilters.every((f) => f(row)));
      } else if (typeof args[0] === 'string' && args.length === 3) {
        const [col, op, val] = args as [string, string, unknown];
        if (op === '>=') filters.push((row) => String(row[col]) >= String(val));
        else if (op === '<=') filters.push((row) => String(row[col]) <= String(val));
        else if (op === '=' || op === '==') filters.push((row) => row[col] === val);
      } else if (typeof args[0] === 'object' && args[0] !== null) {
        for (const [k, v] of Object.entries(args[0] as Record<string, unknown>)) {
          filters.push((row) => row[k] === v);
        }
      }
      return builder;
    };
    builder.whereIn = (col: unknown, vals: unknown) => {
      const list = Array.isArray(vals) ? vals as unknown[] : [];
      filters.push((row) => list.includes(row[String(col)]));
      return builder;
    };
    builder.whereNotNull = (col: unknown) => {
      filters.push((row) => row[String(col)] !== null && row[String(col)] !== undefined);
      return builder;
    };
    builder.whereNull = (col: unknown) => {
      filters.push((row) => row[String(col)] === null || row[String(col)] === undefined);
      return builder;
    };
    builder.orderBy = (col: unknown, dir?: unknown) => {
      orderField = String(col);
      orderDir = dir === 'desc' ? 'desc' : 'asc';
      return builder;
    };
    builder.select = (..._fields: unknown[]) => {
      const filtered = dataset.filter((row) => filters.every((f) => f(row)));
      if (orderField) {
        filtered.sort((a, b) => {
          const av = String(a[orderField as string] ?? '');
          const bv = String(b[orderField as string] ?? '');
          return orderDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
        });
      }
      return Promise.resolve(filtered);
    };

    return builder;
  }
  return ((table: string) => builderFor(table)) as unknown as Knex;
}

const CLINIC_ID = '00000000-0000-4000-8000-00000000c111';
const PATIENT_ID = '00000000-0000-4000-8000-00000000a001';
const STAFF_ID = '00000000-0000-4000-8000-00000000b002';

function testUuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

const ROW_ID_BY_LABEL: Record<string, string> = {
  'k10-1': testUuid(101),
  'k10-2': testUuid(102),
  'k10-clinical': testUuid(103),
  'phq9-viva': testUuid(104),
  'note-self': testUuid(105),
  'note-madrs': testUuid(106),
  'note-bad': testUuid(107),
  'om-bad': testUuid(108),
  'k10-one': testUuid(109),
  'h-1': testUuid(110),
  'h-2': testUuid(111),
  'k-1': testUuid(112),
  'k-2': testUuid(113),
  k: testUuid(114),
  p: testUuid(115),
};

function rowId(label: string): string {
  return ROW_ID_BY_LABEL[label] ?? label;
}

function emptyFixture(): Fixture {
  return {
    outcomeMeasures: [],
    clinicalNotes: [],
    staff: [{ id: STAFF_ID, clinic_id: CLINIC_ID, given_name: 'Dr', family_name: 'Test' }],
  };
}

/**
 * Build a fixture-shaped outcome-measure row with sensible column defaults
 * so each test only has to declare the fields that matter for that test.
 */
function om(overrides: Partial<OmRow> & { id: string; measure_type: string; total_score: number | null; created_at: string }): OmRow {
  return {
    patient_id: PATIENT_ID,
    clinic_id: CLINIC_ID,
    episode_id: null,
    template_name: null,
    collection_occasion: 'review',
    completed_at: overrides.completed_at ?? overrides.created_at,
    staff_id: STAFF_ID,
    assigned_for_patient: false,
    status: 'completed',
    deleted_at: null,
    ...overrides,
    id: rowId(overrides.id),
  };
}

/**
 * Build a fixture-shaped clinical-note row with sensible defaults.
 */
function cn(overrides: Partial<CnRow> & { id: string; contact_meta: unknown; created_at: string }): CnRow {
  return {
    patient_id: PATIENT_ID,
    clinic_id: CLINIC_ID,
    episode_id: null,
    note_type: 'assessment',
    status: 'signed',
    deleted_at: null,
    signed_by_id: STAFF_ID,
    signed_at: overrides.signed_at ?? overrides.created_at,
    ...overrides,
    id: rowId(overrides.id),
  };
}

describe('measurementSummaryService — invariants', () => {
  it('returns an empty (but valid) summary when no rows exist', async () => {
    const db = mockKnex(emptyFixture());
    const summary = await buildMeasurementSummaryForPatient(db, {
      clinicId: CLINIC_ID,
      patientId: PATIENT_ID,
    });
    // Schema parse asserts the structural invariants (cross-refs).
    expect(MeasurementDashboardSummarySchema.parse(summary)).toBeDefined();
    expect(summary.series).toHaveLength(0);
    expect(summary.crossInstrumentTimeline).toHaveLength(0);
    expect(summary.latestByFamily.outcome_measure).toHaveLength(0);
    expect(summary.latestByFamily.clinician_rating_scale).toHaveLength(0);
    expect(summary.latestByFamily.self_rated_scale).toHaveLength(0);
  });

  it('groups multiple K10 administrations into one series with trend = improved (lower is better)', async () => {
    const fixture: Fixture = {
      ...emptyFixture(),
      outcomeMeasures: [
        om({ id: 'k10-1', measure_type: 'k10', collection_occasion: 'admission', total_score: 32, created_at: '2026-01-01T00:00:00.000Z' }),
        om({ id: 'k10-2', measure_type: 'k10', collection_occasion: 'review', total_score: 22, created_at: '2026-03-01T00:00:00.000Z' }),
      ],
    };
    const db = mockKnex(fixture);
    const summary = await buildMeasurementSummaryForPatient(db, { clinicId: CLINIC_ID, patientId: PATIENT_ID });
    expect(MeasurementDashboardSummarySchema.parse(summary)).toBeDefined();
    expect(summary.series).toHaveLength(1);
    expect(summary.series[0].instrumentSlug).toBe('k10');
    expect(summary.series[0].family).toBe('outcome_measure');
    expect(summary.series[0].raterType).toBe('clinician');
    expect(summary.series[0].trendSummary.direction).toBe('improved');
    expect(summary.series[0].trendSummary.administrations).toBe(2);
    expect(summary.latestByFamily.outcome_measure).toHaveLength(1);
    expect(summary.latestByFamily.outcome_measure[0].rawScore).toBe(22);
    expect(summary.latestByFamily.outcome_measure[0].severityLabel).toBe('Mild distress');
  });

  it('excludes soft-deleted outcome measure rows from the summary', async () => {
    const fixture: Fixture = {
      ...emptyFixture(),
      outcomeMeasures: [
        om({ id: 'k10-1', measure_type: 'k10', collection_occasion: 'admission', total_score: 32, created_at: '2026-01-01T00:00:00.000Z' }),
        om({
          id: 'k10-2',
          measure_type: 'k10',
          collection_occasion: 'review',
          total_score: 12,
          created_at: '2026-03-01T00:00:00.000Z',
          deleted_at: '2026-03-02T00:00:00.000Z',
        }),
      ],
    };
    const db = mockKnex(fixture);
    const summary = await buildMeasurementSummaryForPatient(db, { clinicId: CLINIC_ID, patientId: PATIENT_ID });
    expect(summary.series).toHaveLength(1);
    expect(summary.series[0]?.trendSummary.administrations).toBe(1);
    expect(summary.series[0]?.latestPoint.rawScore).toBe(32);
  });

  it('EXCLUDES Viva self-rated rows from the outcome_measure family (operator brief invariant)', async () => {
    // Two rows: one outcome-measure (assigned_for_patient=false) and one
    // Viva self-rated (assigned_for_patient=true). The K10 outcome row
    // must end up in family=outcome_measure; the PHQ-9 self-rated row
    // must end up in family=self_rated_scale. No cross-contamination.
    const phq9 = resolveScaleByTemplateName('PHQ-9 (Patient Health Questionnaire-9)');
    expect(phq9?.slug).toBe('phq9');
    const fixture: Fixture = {
      ...emptyFixture(),
      outcomeMeasures: [
        om({ id: 'k10-clinical', measure_type: 'k10', total_score: 22, created_at: '2026-02-01T00:00:00.000Z' }),
        om({
          id: 'phq9-viva',
          measure_type: phq9!.displayName,
          template_name: phq9!.displayName,
          collection_occasion: 'Viva App',
          total_score: 12,
          created_at: '2026-02-15T00:00:00.000Z',
          assigned_for_patient: true,
        }),
      ],
    };
    const db = mockKnex(fixture);
    const summary = await buildMeasurementSummaryForPatient(db, { clinicId: CLINIC_ID, patientId: PATIENT_ID });
    expect(MeasurementDashboardSummarySchema.parse(summary)).toBeDefined();
    // We expect exactly two series: K10 outcome + PHQ-9 self-rated.
    expect(summary.series).toHaveLength(2);
    const families = summary.series.map((s) => s.family).sort();
    expect(families).toEqual(['outcome_measure', 'self_rated_scale']);
    // Latest by family is non-overlapping.
    expect(summary.latestByFamily.outcome_measure).toHaveLength(1);
    expect(summary.latestByFamily.outcome_measure[0].instrumentSlug).toBe('k10');
    expect(summary.latestByFamily.self_rated_scale).toHaveLength(1);
    expect(summary.latestByFamily.self_rated_scale[0].instrumentSlug).toBe('phq9');
    expect(summary.latestByFamily.self_rated_scale[0].submittedByPatient).toBe(true);
    expect(summary.latestByFamily.clinician_rating_scale).toHaveLength(0);
  });

  it('EXCLUDES patient self-rated rows from clinician rating-scale notes route', async () => {
    // A clinical_notes row with respondentType=self must NOT appear under
    // family=clinician_rating_scale. The aggregation skips it.
    const fixture: Fixture = {
      ...emptyFixture(),
      clinicalNotes: [
        cn({
          id: 'note-self',
          contact_meta: JSON.stringify({
            ratingScale: {
              templateName: 'PHQ-9 (Patient Health Questionnaire-9)',
              respondentType: 'self',
              totalScore: 9,
            },
          }),
          created_at: '2026-04-01T00:00:00.000Z',
        }),
      ],
    };
    const db = mockKnex(fixture);
    const summary = await buildMeasurementSummaryForPatient(db, { clinicId: CLINIC_ID, patientId: PATIENT_ID });
    expect(MeasurementDashboardSummarySchema.parse(summary)).toBeDefined();
    expect(summary.series).toHaveLength(0);
    expect(summary.latestByFamily.clinician_rating_scale).toHaveLength(0);
  });

  it('SURFACES a clinician-rated rating scale from clinical_notes contactMeta', async () => {
    // MADRS clinician-rated note with structured totalScore must appear
    // under family=clinician_rating_scale.
    const fixture: Fixture = {
      ...emptyFixture(),
      clinicalNotes: [
        cn({
          id: 'note-madrs',
          contact_meta: JSON.stringify({
            ratingScale: {
              templateName: 'MADRS (Montgomery-Åsberg Depression Rating Scale)',
              respondentType: 'clinician',
              totalScore: 22,
              itemCount: 10,
            },
          }),
          created_at: '2026-04-01T00:00:00.000Z',
        }),
      ],
    };
    const db = mockKnex(fixture);
    const summary = await buildMeasurementSummaryForPatient(db, { clinicId: CLINIC_ID, patientId: PATIENT_ID });
    expect(MeasurementDashboardSummarySchema.parse(summary)).toBeDefined();
    expect(summary.series).toHaveLength(1);
    expect(summary.series[0].instrumentSlug).toBe('madrs');
    expect(summary.series[0].family).toBe('clinician_rating_scale');
    expect(summary.series[0].raterType).toBe('clinician');
    expect(summary.series[0].latestPoint?.severityLabel).toBe('Moderate');
    expect(summary.latestByFamily.clinician_rating_scale).toHaveLength(1);
  });

  it('warns on (and excludes) clinical_notes rows whose templateName resolves to a self-rated scale', async () => {
    // A note tagged respondentType=clinician but whose templateName is
    // a self-rated scale (PHQ-9) — registry resolves PHQ-9 to self_rated,
    // so the aggregation must NOT classify it as clinician-rated.
    const fixture: Fixture = {
      ...emptyFixture(),
      clinicalNotes: [
        cn({
          id: 'note-bad',
          contact_meta: JSON.stringify({
            ratingScale: {
              templateName: 'PHQ-9 (Patient Health Questionnaire-9)',
              respondentType: 'clinician',
              totalScore: 14,
            },
          }),
          created_at: '2026-04-01T00:00:00.000Z',
        }),
      ],
    };
    const db = mockKnex(fixture);
    const summary = await buildMeasurementSummaryForPatient(db, { clinicId: CLINIC_ID, patientId: PATIENT_ID });
    expect(MeasurementDashboardSummarySchema.parse(summary)).toBeDefined();
    expect(summary.series).toHaveLength(0);
    const unsupported = summary.warnings.find((w) => w.code === 'unsupported_instrument' && w.source === 'clinical_note_rating_scale');
    expect(unsupported).toBeDefined();
    expect(unsupported?.count).toBe(1);
  });

  it('warns on outcome_measures rows with an unknown measure_type', async () => {
    const fixture: Fixture = {
      ...emptyFixture(),
      outcomeMeasures: [
        om({ id: 'om-bad', measure_type: 'totally-not-a-real-scale', total_score: 10, created_at: '2026-02-01T00:00:00.000Z' }),
      ],
    };
    const db = mockKnex(fixture);
    const summary = await buildMeasurementSummaryForPatient(db, { clinicId: CLINIC_ID, patientId: PATIENT_ID });
    expect(MeasurementDashboardSummarySchema.parse(summary)).toBeDefined();
    expect(summary.series).toHaveLength(0);
    expect(summary.warnings.some((w) => w.code === 'unsupported_instrument' && w.source === 'outcome_measure')).toBe(true);
  });

  it('warns insufficient_history when there is only one administration of a scale', async () => {
    const fixture: Fixture = {
      ...emptyFixture(),
      outcomeMeasures: [
        om({ id: 'k10-one', measure_type: 'k10', collection_occasion: 'admission', total_score: 22, created_at: '2026-02-01T00:00:00.000Z' }),
      ],
    };
    const db = mockKnex(fixture);
    const summary = await buildMeasurementSummaryForPatient(db, { clinicId: CLINIC_ID, patientId: PATIENT_ID });
    expect(MeasurementDashboardSummarySchema.parse(summary)).toBeDefined();
    expect(summary.series).toHaveLength(1);
    expect(summary.series[0].trendSummary.direction).toBe('insufficient_data');
    expect(summary.warnings.some((w) => w.code === 'insufficient_history' && w.instrumentSlug === 'k10')).toBe(true);
  });

  it('returns separate series for HoNOS + K10 (different instruments are not merged)', async () => {
    const fixture: Fixture = {
      ...emptyFixture(),
      outcomeMeasures: [
        om({ id: 'h-1', measure_type: 'honos', collection_occasion: 'admission', total_score: 18, created_at: '2026-01-01T00:00:00.000Z' }),
        om({ id: 'h-2', measure_type: 'honos', collection_occasion: 'review', total_score: 14, created_at: '2026-03-01T00:00:00.000Z' }),
        om({ id: 'k-1', measure_type: 'k10', collection_occasion: 'admission', total_score: 30, created_at: '2026-01-15T00:00:00.000Z' }),
        om({ id: 'k-2', measure_type: 'k10', collection_occasion: 'review', total_score: 18, created_at: '2026-03-15T00:00:00.000Z' }),
      ],
    };
    const db = mockKnex(fixture);
    const summary = await buildMeasurementSummaryForPatient(db, { clinicId: CLINIC_ID, patientId: PATIENT_ID });
    expect(MeasurementDashboardSummarySchema.parse(summary)).toBeDefined();
    // 2 series — one per instrument; raw scores are NOT combined.
    expect(summary.series).toHaveLength(2);
    const slugs = summary.series.map((s) => s.instrumentSlug).sort();
    expect(slugs).toEqual(['honos', 'k10']);
    // Cross-instrument timeline keeps every event with its own
    // per-instrument context (no shared y-axis).
    expect(summary.crossInstrumentTimeline).toHaveLength(4);
    // No "stable" trend on the K10 because raw delta is -12 (improved).
    const k10series = summary.series.find((s) => s.instrumentSlug === 'k10')!;
    expect(k10series.trendSummary.direction).toBe('improved');
  });

  it('respects family filter: family=self_rated_scale excludes outcome_measure + clinician rows', async () => {
    const phq9 = resolveScaleByTemplateName('PHQ-9 (Patient Health Questionnaire-9)');
    const fixture: Fixture = {
      ...emptyFixture(),
      outcomeMeasures: [
        om({ id: 'k', measure_type: 'k10', total_score: 22, created_at: '2026-02-01T00:00:00.000Z' }),
        om({
          id: 'p',
          measure_type: phq9!.displayName,
          template_name: phq9!.displayName,
          collection_occasion: 'Viva App',
          total_score: 12,
          created_at: '2026-02-15T00:00:00.000Z',
          assigned_for_patient: true,
        }),
      ],
    };
    const db = mockKnex(fixture);
    const summary = await buildMeasurementSummaryForPatient(db, {
      clinicId: CLINIC_ID,
      patientId: PATIENT_ID,
      family: 'self_rated_scale',
    });
    expect(MeasurementDashboardSummarySchema.parse(summary)).toBeDefined();
    expect(summary.series).toHaveLength(1);
    expect(summary.series[0].instrumentSlug).toBe('phq9');
    expect(summary.latestByFamily.outcome_measure).toHaveLength(0);
  });
});

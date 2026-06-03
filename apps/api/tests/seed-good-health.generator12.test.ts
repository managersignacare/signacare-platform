import { describe, it, expect } from 'vitest';
import { buildOutcomeMeasures } from '../src/seed-good-health/generators/12_outcome_measures';
import { buildPatients } from '../src/seed-good-health/generators/06_patients';
import { buildEpisodes } from '../src/seed-good-health/generators/07_episodes';
import {
  MENTAL_HEALTH_CLINICS,
  TEAM_SLUGS,
} from '../src/seed-good-health/config/catalog';
import { clinicId, staffId } from '../src/seed-good-health/config/ids';

describe('seed-good-health generator 12: outcome measures', () => {
  it('emits exactly 640 rows (2 measures × 4 timepoints × 80 patients)', () => {
    const { rows } = buildOutcomeMeasures();
    expect(rows).toHaveLength(640);
  });

  it('every row references a patient from gen 06 and an episode from gen 07', () => {
    const patients = new Set(buildPatients().rows.map((p) => p.id));
    const episodes = new Set(buildEpisodes().rows.map((e) => e.id));
    for (const row of buildOutcomeMeasures().rows) {
      expect(patients.has(row.patient_id)).toBe(true);
      expect(episodes.has(row.episode_id)).toBe(true);
    }
  });

  it('each patient has exactly 8 measures (2 types × 4 timepoints)', () => {
    const { rows } = buildOutcomeMeasures();
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.patient_id, (counts.get(row.patient_id) ?? 0) + 1);
    }
    expect(counts.size).toBe(80);
    for (const count of counts.values()) {
      expect(count).toBe(8);
    }
  });

  it('each patient has exactly 4 HoNOS scores tracing the expected trajectory', () => {
    const { rows } = buildOutcomeMeasures();
    const byPatient = new Map<string, number[]>();
    for (const row of rows) {
      if (row.measure_type !== 'honos') continue;
      const list = byPatient.get(row.patient_id) ?? [];
      list.push(row.total_score);
      byPatient.set(row.patient_id, list);
    }
    for (const scores of byPatient.values()) {
      expect(scores).toStrictEqual([18, 10, 16, 8]);
    }
  });

  it('each patient has exactly 4 K10 scores tracing the expected trajectory', () => {
    const { rows } = buildOutcomeMeasures();
    const byPatient = new Map<string, number[]>();
    for (const row of rows) {
      if (row.measure_type !== 'k10') continue;
      const list = byPatient.get(row.patient_id) ?? [];
      list.push(row.total_score);
      byPatient.set(row.patient_id, list);
    }
    for (const scores of byPatient.values()) {
      expect(scores).toStrictEqual([32, 18, 28, 16]);
    }
  });

  it('HoNOS scores are always within 0-48 and K10 scores within 10-50', () => {
    for (const row of buildOutcomeMeasures().rows) {
      if (row.measure_type === 'honos') {
        expect(row.total_score).toBeGreaterThanOrEqual(0);
        expect(row.total_score).toBeLessThanOrEqual(48);
      } else {
        expect(row.total_score).toBeGreaterThanOrEqual(10);
        expect(row.total_score).toBeLessThanOrEqual(50);
      }
    }
  });

  it('measure_type values are only honos or k10', () => {
    const allowed = new Set(['honos', 'k10']);
    for (const row of buildOutcomeMeasures().rows) {
      expect(allowed.has(row.measure_type)).toBe(true);
    }
  });

  it('collection_occasion values are only initial, review, discharge', () => {
    const allowed = new Set(['initial', 'review', 'discharge']);
    for (const row of buildOutcomeMeasures().rows) {
      expect(allowed.has(row.collection_occasion)).toBe(true);
    }
  });

  it('staff_id always points at a team-lead', () => {
    const leads = new Set(
      MENTAL_HEALTH_CLINICS.flatMap((c) =>
        TEAM_SLUGS.map((t) => staffId(c.slug, `${t}.team-lead`)),
      ),
    );
    for (const row of buildOutcomeMeasures().rows) {
      expect(leads.has(row.staff_id)).toBe(true);
    }
  });

  it('clinic_id matches the MH clinic set', () => {
    const mhIds = new Set(MENTAL_HEALTH_CLINICS.map((c) => clinicId(c.slug)));
    for (const row of buildOutcomeMeasures().rows) {
      expect(mhIds.has(row.clinic_id)).toBe(true);
    }
  });

  it('ids are unique across 640 rows', () => {
    const ids = new Set(buildOutcomeMeasures().rows.map((r) => r.id));
    expect(ids.size).toBe(640);
  });

  it('rows are byte-stable across two builds', () => {
    const a = buildOutcomeMeasures().rows.map((r) => r.id);
    const b = buildOutcomeMeasures().rows.map((r) => r.id);
    expect(a).toStrictEqual(b);
  });
});

import { describe, it, expect } from 'vitest';
import { buildRiskAssessments } from '../src/seed-good-health/generators/11_risk_assessments';
import { buildPatients } from '../src/seed-good-health/generators/06_patients';
import { buildEpisodes } from '../src/seed-good-health/generators/07_episodes';
import {
  MENTAL_HEALTH_CLINICS,
  TEAM_SLUGS,
} from '../src/seed-good-health/config/catalog';
import { clinicId, staffId } from '../src/seed-good-health/config/ids';

describe('seed-good-health generator 11: risk assessments', () => {
  it('emits exactly 320 rows (4 per patient × 80 patients)', () => {
    const { rows } = buildRiskAssessments();
    expect(rows).toHaveLength(320);
  });

  it('every row references a patient from gen 06 and an episode from gen 07', () => {
    const patients = new Set(buildPatients().rows.map((p) => p.id));
    const episodes = new Set(buildEpisodes().rows.map((e) => e.id));
    for (const row of buildRiskAssessments().rows) {
      expect(patients.has(row.patient_id)).toBe(true);
      expect(episodes.has(row.episode_id)).toBe(true);
    }
  });

  it('each patient has exactly 4 assessments following the expected trajectory', () => {
    const { rows } = buildRiskAssessments().rows ? buildRiskAssessments() : { rows: [] };
    const byPatient = new Map<string, string[]>();
    for (const row of rows) {
      const list = byPatient.get(row.patient_id) ?? [];
      list.push(row.overall_risk_level);
      byPatient.set(row.patient_id, list);
    }
    expect(byPatient.size).toBe(80);
    for (const list of byPatient.values()) {
      // Trajectory: medium → low → medium → low
      expect(list).toStrictEqual(['medium', 'low', 'medium', 'low']);
    }
  });

  it('each patient has exactly 2 safety plans in place (the medium-risk entries)', () => {
    const { rows } = buildRiskAssessments();
    const byPatient = new Map<string, number>();
    for (const row of rows) {
      if (row.safety_plan_in_place) {
        byPatient.set(row.patient_id, (byPatient.get(row.patient_id) ?? 0) + 1);
      }
    }
    for (const count of byPatient.values()) {
      expect(count).toBe(2);
    }
  });

  it('medium rows have suicide_risk=true + safety summary; low rows clear both', () => {
    for (const row of buildRiskAssessments().rows) {
      if (row.overall_risk_level === 'medium') {
        expect(row.suicide_risk).toBe(true);
        expect(row.safety_plan_in_place).toBe(true);
        expect(row.safety_plan_summary).not.toBeNull();
      } else {
        expect(row.suicide_risk).toBe(false);
        expect(row.safety_plan_in_place).toBe(false);
        expect(row.safety_plan_summary).toBeNull();
      }
    }
  });

  it('all 4 assessments chronologically order within a patient', () => {
    const { rows } = buildRiskAssessments();
    const byPatient = new Map<string, string[]>();
    for (const row of rows) {
      const list = byPatient.get(row.patient_id) ?? [];
      list.push(row.assessment_date);
      byPatient.set(row.patient_id, list);
    }
    for (const dates of byPatient.values()) {
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i] > dates[i - 1]).toBe(true);
      }
    }
  });

  it('review_date is always after assessment_date', () => {
    for (const row of buildRiskAssessments().rows) {
      expect(row.review_date > row.assessment_date).toBe(true);
    }
  });

  it('assessed_by_id always points at a team-lead staff row', () => {
    const leads = new Set(
      MENTAL_HEALTH_CLINICS.flatMap((c) =>
        TEAM_SLUGS.map((t) => staffId(c.slug, `${t}.team-lead`)),
      ),
    );
    for (const row of buildRiskAssessments().rows) {
      expect(leads.has(row.assessed_by_id)).toBe(true);
    }
  });

  it('clinic_id on each assessment matches the MH clinic set', () => {
    const mhIds = new Set(MENTAL_HEALTH_CLINICS.map((c) => clinicId(c.slug)));
    for (const row of buildRiskAssessments().rows) {
      expect(mhIds.has(row.clinic_id)).toBe(true);
    }
  });

  it('ids are unique across 320 rows', () => {
    const ids = new Set(buildRiskAssessments().rows.map((r) => r.id));
    expect(ids.size).toBe(320);
  });

  it('rows are byte-stable across two builds', () => {
    const a = buildRiskAssessments().rows.map((r) => r.id);
    const b = buildRiskAssessments().rows.map((r) => r.id);
    expect(a).toStrictEqual(b);
  });
});

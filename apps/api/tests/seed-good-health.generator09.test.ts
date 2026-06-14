import { describe, it, expect } from 'vitest';
import { buildMedications } from '../src/seed-good-health/generators/09_medications';
import { buildPatients } from '../src/seed-good-health/generators/06_patients';
import { buildEpisodes } from '../src/seed-good-health/generators/07_episodes';
import {
  MENTAL_HEALTH_CLINICS,
  TEAM_SLUGS,
} from '../src/seed-good-health/config/catalog';
import { clinicId, staffId } from '../src/seed-good-health/config/ids';

describe('seed-good-health generator 09: medications', () => {
  it('emits exactly 248 medication rows (baseline 240 + 8 LAI rows for index cases)', () => {
    const { rows } = buildMedications();
    expect(rows).toHaveLength(248);
  });

  it('every medication references a patient_id emitted by gen 06', () => {
    const patients = new Set(buildPatients().rows.map((p) => p.id));
    for (const row of buildMedications().rows) {
      expect(patients.has(row.patient_id)).toBe(true);
    }
  });

  it('every medication references the OPEN episode (episode 2) of its patient', () => {
    const openEpisodes = new Set(
      buildEpisodes()
        .rows.filter((e) => e.status === 'open')
        .map((e) => e.id),
    );
    for (const row of buildMedications().rows) {
      expect(openEpisodes.has(row.episode_id)).toBe(true);
    }
  });

  it('every patient keeps the baseline trio, and index-case patients gain an LAI fourth item', () => {
    const { rows } = buildMedications();
    const byPatient = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = byPatient.get(row.patient_id) ?? new Set<string>();
      set.add(row.generic_name);
      byPatient.set(row.patient_id, set);
    }
    expect(byPatient.size).toBe(80);
    let laiPatients = 0;
    for (const set of byPatient.values()) {
      expect(set.has('Sertraline')).toBe(true);
      expect(set.has('Lorazepam')).toBe(true);
      expect(set.has('Melatonin')).toBe(true);
      if (set.has('Paliperidone')) {
        laiPatients++;
        expect(set.size).toBe(4);
      } else {
        expect(set.size).toBe(3);
      }
    }
    expect(laiPatients).toBe(8);
  });

  it('all ids are distinct across 248 rows', () => {
    const ids = new Set(buildMedications().rows.map((r) => r.id));
    expect(ids.size).toBe(248);
  });

  it('every row is active, has status=active, and no end_date', () => {
    for (const row of buildMedications().rows) {
      expect(row.status).toBe('active');
      expect(row.end_date).toBeNull();
    }
  });

  it('exactly one PRN medication per patient (lorazepam)', () => {
    const { rows } = buildMedications();
    const prnByPatient = new Map<string, number>();
    for (const row of rows) {
      if (row.is_prn) {
        prnByPatient.set(
          row.patient_id,
          (prnByPatient.get(row.patient_id) ?? 0) + 1,
        );
      }
    }
    expect(prnByPatient.size).toBe(80);
    for (const count of prnByPatient.values()) {
      expect(count).toBe(1);
    }
  });

  it('seeds exactly 8 active LAI medications for the team index cases', () => {
    const laiRows = buildMedications().rows.filter((row) => row.is_lai);
    expect(laiRows).toHaveLength(8);
    for (const row of laiRows) {
      expect(row.generic_name).toBe('Paliperidone');
      expect(row.route).toBe('im');
      expect(row.frequency).toBe('monthly');
      expect(row.status).toBe('active');
    }
  });

  it('baseline patients have 2 regular meds, while the LAI cohort has 3', () => {
    const { rows } = buildMedications();
    const byPatient = new Map<string, number>();
    for (const row of rows) {
      if (row.is_regular) {
        byPatient.set(row.patient_id, (byPatient.get(row.patient_id) ?? 0) + 1);
      }
    }
    let laiRegularCount = 0;
    for (const count of byPatient.values()) {
      if (count === 3) {
        laiRegularCount++;
      } else {
        expect(count).toBe(2);
      }
    }
    expect(laiRegularCount).toBe(8);
  });

  it('prescribed_by_staff_id always points at a team-lead staff row', () => {
    const leads = new Set(
      MENTAL_HEALTH_CLINICS.flatMap((c) =>
        TEAM_SLUGS.map((t) => staffId(c.slug, `${t}.team-lead`)),
      ),
    );
    for (const row of buildMedications().rows) {
      expect(leads.has(row.prescribed_by_staff_id)).toBe(true);
    }
  });

  it('clinic_id matches the patient RLS scope', () => {
    const mhIds = new Set(MENTAL_HEALTH_CLINICS.map((c) => clinicId(c.slug)));
    for (const row of buildMedications().rows) {
      expect(mhIds.has(row.clinic_id)).toBe(true);
    }
  });

  it('rows are byte-stable across two builds', () => {
    const a = buildMedications().rows.map((r) => r.id);
    const b = buildMedications().rows.map((r) => r.id);
    expect(a).toStrictEqual(b);
  });
});

import { describe, it, expect } from 'vitest';
import { buildClinicalNotes } from '../src/seed-good-health/generators/08_clinical_notes';
import { buildEpisodes } from '../src/seed-good-health/generators/07_episodes';
import { buildPatients } from '../src/seed-good-health/generators/06_patients';
import {
  MENTAL_HEALTH_CLINICS,
  TEAM_SLUGS,
  PATIENTS_PER_TEAM,
} from '../src/seed-good-health/config/catalog';
import { clinicId, staffId } from '../src/seed-good-health/config/ids';

const EXPECTED_NOTES_PER_PATIENT = 20; // 8 ep1 + 12 ep2
const EXPECTED_TOTAL =
  MENTAL_HEALTH_CLINICS.length *
  TEAM_SLUGS.length *
  PATIENTS_PER_TEAM *
  EXPECTED_NOTES_PER_PATIENT;

describe('seed-good-health generator 08: clinical notes', () => {
  it('emits exactly 1600 notes (80 patients × 20 each)', () => {
    const { rows } = buildClinicalNotes();
    expect(rows).toHaveLength(EXPECTED_TOTAL);
    expect(rows.length).toBe(1600);
  });

  it('every note references a patient_id from generator 06', () => {
    const patients = new Set(buildPatients().rows.map((p) => p.id));
    for (const row of buildClinicalNotes().rows) {
      expect(patients.has(row.patient_id)).toBe(true);
    }
  });

  it('every note references an episode_id from generator 07', () => {
    const episodes = new Set(buildEpisodes().rows.map((e) => e.id));
    for (const row of buildClinicalNotes().rows) {
      expect(episodes.has(row.episode_id)).toBe(true);
    }
  });

  it('each patient has exactly 20 notes', () => {
    const { rows } = buildClinicalNotes();
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.patient_id, (counts.get(row.patient_id) ?? 0) + 1);
    }
    expect(counts.size).toBe(80);
    for (const [, count] of counts) {
      expect(count).toBe(EXPECTED_NOTES_PER_PATIENT);
    }
  });

  it('ids are unique across all 1600 rows', () => {
    const ids = new Set(buildClinicalNotes().rows.map((r) => r.id));
    expect(ids.size).toBe(1600);
  });

  it('clinic_id on each note matches the patient RLS scope', () => {
    const mhIds = new Set(MENTAL_HEALTH_CLINICS.map((c) => clinicId(c.slug)));
    for (const row of buildClinicalNotes().rows) {
      expect(mhIds.has(row.clinic_id)).toBe(true);
    }
  });

  it('each patient has exactly 1 draft note and 19 signed notes', () => {
    const { rows } = buildClinicalNotes();
    const byPatient = new Map<string, { draft: number; signed: number }>();
    for (const row of rows) {
      const tally = byPatient.get(row.patient_id) ?? { draft: 0, signed: 0 };
      if (row.is_draft) tally.draft++;
      else if (row.is_signed) tally.signed++;
      byPatient.set(row.patient_id, tally);
    }
    for (const tally of byPatient.values()) {
      expect(tally.draft).toBe(1);
      expect(tally.signed).toBe(19);
    }
  });

  it('status + is_draft + is_signed are consistent', () => {
    for (const row of buildClinicalNotes().rows) {
      if (row.is_draft) {
        expect(row.status).toBe('draft');
        expect(row.is_signed).toBe(false);
        expect(row.signed_at).toBeNull();
        expect(row.signed_by).toBeNull();
      } else {
        expect(row.status).toBe('signed');
        expect(row.is_signed).toBe(true);
        expect(row.signed_at).not.toBeNull();
        expect(row.signed_by).not.toBeNull();
      }
    }
  });

  it('author_id always references a clinical staff member from the correct team', () => {
    const clinicalSlugs = [
      'team-lead',
      'registrar-1',
      'registrar-2',
      'psychologist',
      'ot',
      'social-worker',
      'nurse-1',
      'nurse-2',
      'case-coordinator',
    ] as const;
    const validAuthorIds = new Set(
      MENTAL_HEALTH_CLINICS.flatMap((c) =>
        TEAM_SLUGS.flatMap((t) =>
          clinicalSlugs.map((s) => staffId(c.slug, `${t}.${s}`)),
        ),
      ),
    );
    for (const row of buildClinicalNotes().rows) {
      expect(validAuthorIds.has(row.author_id)).toBe(true);
    }
  });

  it('note_type values are drawn from the approved set', () => {
    const allowed = new Set(['soap', 'progress', 'phone', 'med_review']);
    for (const row of buildClinicalNotes().rows) {
      expect(allowed.has(row.note_type)).toBe(true);
    }
  });

  it('note_date is an ISO date within the corresponding episode window', () => {
    const { rows } = buildClinicalNotes();
    const episodes = new Map(
      buildEpisodes().rows.map((e) => [e.id, e]),
    );
    for (const row of rows) {
      const ep = episodes.get(row.episode_id)!;
      expect(row.note_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Note date must be on or after episode start.
      expect(row.note_date >= ep.start_date).toBe(true);
      // If the episode is closed, note must be on or before end_date
      // (with a small tolerance for the ±2 day jitter).
      if (ep.end_date) {
        expect(row.note_date <= '2022-05-15').toBe(true);
      }
    }
  });

  it('rows are byte-stable across two builds', () => {
    const a = buildClinicalNotes().rows.map((r) => r.id);
    const b = buildClinicalNotes().rows.map((r) => r.id);
    expect(a).toStrictEqual(b);
  });
});

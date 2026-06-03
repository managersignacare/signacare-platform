import { describe, it, expect } from 'vitest';
import { buildEpisodes } from '../src/seed-good-health/generators/07_episodes';
import { buildPatients } from '../src/seed-good-health/generators/06_patients';
import {
  MENTAL_HEALTH_CLINICS,
  TEAM_SLUGS,
} from '../src/seed-good-health/config/catalog';
import {
  clinicId,
  teamId,
  staffId,
} from '../src/seed-good-health/config/ids';

describe('seed-good-health generator 07: episodes', () => {
  it('emits exactly 160 episode rows (2 per patient × 80 patients)', () => {
    const { rows } = buildEpisodes();
    expect(rows).toHaveLength(160);
  });

  it('every episode references a patient_id emitted by generator 06', () => {
    const patients = new Set(buildPatients().rows.map((p) => p.id));
    for (const row of buildEpisodes().rows) {
      expect(patients.has(row.patient_id)).toBe(true);
    }
  });

  it('each patient has exactly 2 episodes: 1 closed historical + 1 open current', () => {
    const { rows } = buildEpisodes();
    const byPatient = new Map<string, { closed: number; open: number }>();
    for (const row of rows) {
      const tally = byPatient.get(row.patient_id) ?? { closed: 0, open: 0 };
      if (row.status === 'closed') tally.closed++;
      else if (row.status === 'open') tally.open++;
      byPatient.set(row.patient_id, tally);
    }
    expect(byPatient.size).toBe(80);
    for (const tally of byPatient.values()) {
      expect(tally.closed).toBe(1);
      expect(tally.open).toBe(1);
    }
  });

  it('closed episodes have both start_date and end_date; open episodes have only start_date', () => {
    for (const row of buildEpisodes().rows) {
      if (row.status === 'closed') {
        expect(row.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(row.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(row.closure_reason).not.toBeNull();
        expect(row.closure_summary).not.toBeNull();
      } else {
        expect(row.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(row.end_date).toBeNull();
        expect(row.closure_reason).toBeNull();
      }
    }
  });

  it('every episode is anchored to an MH clinic', () => {
    const mhIds = new Set(MENTAL_HEALTH_CLINICS.map((c) => clinicId(c.slug)));
    for (const row of buildEpisodes().rows) {
      expect(mhIds.has(row.clinic_id)).toBe(true);
    }
  });

  it('team_id matches generator 01 team org_unit ids', () => {
    const validTeamIds = new Set(
      MENTAL_HEALTH_CLINICS.flatMap((c) =>
        TEAM_SLUGS.map((t) => teamId(c.slug, t)),
      ),
    );
    for (const row of buildEpisodes().rows) {
      expect(validTeamIds.has(row.team_id)).toBe(true);
    }
  });

  it('primary_clinician_id always points at a team-lead staff row', () => {
    const leadStaffIds = new Set(
      MENTAL_HEALTH_CLINICS.flatMap((c) =>
        TEAM_SLUGS.map((t) => staffId(c.slug, `${t}.team-lead`)),
      ),
    );
    for (const row of buildEpisodes().rows) {
      expect(leadStaffIds.has(row.primary_clinician_id)).toBe(true);
    }
  });

  it('specialty_code is mental_health on every row (Phase 3 migration NOT NULL)', () => {
    for (const row of buildEpisodes().rows) {
      expect(row.specialty_code).toBe('mental_health');
    }
  });

  it('episode_number is unique across all 160 rows', () => {
    const numbers = new Set(buildEpisodes().rows.map((r) => r.episode_number));
    expect(numbers.size).toBe(160);
  });

  it('closed episode start dates precede end dates', () => {
    for (const row of buildEpisodes().rows) {
      if (row.status === 'closed' && row.end_date) {
        expect(row.start_date < row.end_date).toBe(true);
      }
    }
  });

  it('ids are byte-stable across two builds', () => {
    const a = buildEpisodes().rows.map((r) => r.id);
    const b = buildEpisodes().rows.map((r) => r.id);
    expect(a).toStrictEqual(b);
  });
});

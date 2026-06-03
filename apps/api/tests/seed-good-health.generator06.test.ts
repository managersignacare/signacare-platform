import { describe, it, expect } from 'vitest';
import { buildPatients } from '../src/seed-good-health/generators/06_patients';
import {
  MENTAL_HEALTH_CLINICS,
  TEAM_SLUGS,
  PATIENTS_PER_TEAM,
} from '../src/seed-good-health/config/catalog';
import { clinicId } from '../src/seed-good-health/config/ids';

const EXPECTED = MENTAL_HEALTH_CLINICS.length * TEAM_SLUGS.length * PATIENTS_PER_TEAM;

describe('seed-good-health generator 06: patients', () => {
  it('emits exactly 80 patient rows', () => {
    const { rows } = buildPatients();
    expect(rows).toHaveLength(EXPECTED);
    expect(rows.length).toBe(80);
  });

  it('each patient row is RLS-scoped to one of the 4 MH clinics', () => {
    const { rows } = buildPatients();
    const mhClinicIds = new Set(
      MENTAL_HEALTH_CLINICS.map((c) => clinicId(c.slug)),
    );
    for (const row of rows) {
      expect(mhClinicIds.has(row.clinic_id)).toBe(true);
    }
  });

  it('each clinic has exactly 20 patients', () => {
    const { rows } = buildPatients();
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.clinic_id, (counts.get(row.clinic_id) ?? 0) + 1);
    }
    expect(counts.size).toBe(MENTAL_HEALTH_CLINICS.length);
    for (const [, count] of counts) {
      expect(count).toBe(PATIENTS_PER_TEAM * TEAM_SLUGS.length);
    }
  });

  it('all 80 patient ids are distinct', () => {
    const { rows } = buildPatients();
    const ids = new Set(rows.map((r) => r.id));
    expect(ids.size).toBe(80);
  });

  it('each patient id is a v5 uuid', () => {
    const { rows } = buildPatients();
    for (const row of rows) {
      expect(row.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it('emr numbers follow the GH-<CLINIC3>-<TEAM1>-<NNN> pattern and are unique', () => {
    const { rows } = buildPatients();
    const emrs = new Set<string>();
    for (const row of rows) {
      expect(row.emr_number).toMatch(/^GH-[A-Z]{3}-[AB]-\d{3}$/);
      expect(emrs.has(row.emr_number)).toBe(false);
      emrs.add(row.emr_number);
    }
    expect(emrs.size).toBe(80);
  });

  it('date_of_birth is a valid ISO date between 1961 and 2005', () => {
    const { rows } = buildPatients();
    for (const row of rows) {
      expect(row.date_of_birth).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const [yearStr] = row.date_of_birth.split('-');
      const year = parseInt(yearStr, 10);
      expect(year).toBeGreaterThanOrEqual(1961);
      expect(year).toBeLessThanOrEqual(2005);
    }
  });

  it('gender is drawn from the canonical pool', () => {
    const { rows } = buildPatients();
    const allowed = new Set(['female', 'male', 'non-binary']);
    for (const row of rows) {
      expect(allowed.has(row.gender)).toBe(true);
    }
  });

  it('gender distribution roughly reflects the 5:5:1 weighting', () => {
    const { rows } = buildPatients();
    const counts = { female: 0, male: 0, 'non-binary': 0 };
    for (const row of rows) {
      counts[row.gender as keyof typeof counts]++;
    }
    // Female + male should each be >= non-binary.
    expect(counts.female).toBeGreaterThanOrEqual(counts['non-binary']);
    expect(counts.male).toBeGreaterThanOrEqual(counts['non-binary']);
    // 80 patients: non-binary should not exceed ~30% (expected ~7).
    expect(counts['non-binary']).toBeLessThan(25);
  });

  it('every patient inherits suburb/state/postcode from their clinic catalog', () => {
    const { rows } = buildPatients();
    const catalogByClinicId = new Map(
      MENTAL_HEALTH_CLINICS.map((c) => [clinicId(c.slug), c]),
    );
    for (const row of rows) {
      const catalog = catalogByClinicId.get(row.clinic_id)!;
      expect(row.suburb).toBe(catalog.suburb);
      expect(row.state).toBe(catalog.state);
      expect(row.postcode).toBe(catalog.postcode);
    }
  });

  it('rows are byte-stable across two builds (idempotency proof)', () => {
    const a = buildPatients();
    const b = buildPatients();
    expect(a.rows).toStrictEqual(b.rows);
  });
});

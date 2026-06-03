import { describe, it, expect } from 'vitest';
import {
  buildClinicRows,
  buildOrgUnitRows,
  buildProgramRows,
} from '../src/seed-good-health/generators/01_clinics';
import { CLINICS, MENTAL_HEALTH_CLINICS, PROGRAMS } from '../src/seed-good-health/config/catalog';

// Phase 0.8 PR1 generator-01 unit tests. These run without a database
// so CI proves: row counts match the catalog, every row has a stable
// id that re-runs produce the same value, every parent_id references
// an id that exists in the same row set, and programs are only
// attached to teams their catalog entry declares. If one of these
// breaks, the on-conflict upsert path in runClinicsStep would produce
// orphans or duplicate writes.

describe('seed-good-health generator 01: clinic rows', () => {
  it('emits exactly one row per catalog clinic', () => {
    const rows = buildClinicRows();
    expect(rows).toHaveLength(CLINICS.length);
    expect(rows.length).toBe(5); // 4 mental health + 1 executive
  });

  it('is byte-stable across calls (idempotency proof)', () => {
    expect(buildClinicRows()).toStrictEqual(buildClinicRows());
  });

  it('every clinic id is a v5 uuid', () => {
    for (const row of buildClinicRows()) {
      expect(row.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it('clinic ids are all distinct', () => {
    const ids = new Set(buildClinicRows().map((r) => r.id));
    expect(ids.size).toBe(5);
  });
});

describe('seed-good-health generator 01: org_unit rows', () => {
  it('emits one hospital + two teams per mental health clinic', () => {
    const rows = buildOrgUnitRows();
    expect(rows).toHaveLength(MENTAL_HEALTH_CLINICS.length * 3);
    expect(rows).toHaveLength(12); // 4 * 3
  });

  it('hospital nodes have parent_id null, teams have parent_id = their hospital id', () => {
    const rows = buildOrgUnitRows();
    const hospitals = rows.filter((r) => r.level === 'hospital');
    const teams = rows.filter((r) => r.level === 'team');
    expect(hospitals).toHaveLength(4);
    expect(teams).toHaveLength(8);
    for (const h of hospitals) {
      expect(h.parent_id).toBeNull();
    }
    const hospitalIds = new Set(hospitals.map((h) => h.id));
    for (const t of teams) {
      expect(t.parent_id).not.toBeNull();
      expect(hospitalIds.has(t.parent_id!)).toBe(true);
    }
  });

  it('every org_unit row is clinic-scoped to a valid mental health clinic', () => {
    const mentalHealthClinicIds = new Set(
      buildClinicRows()
        .filter((_, i) => CLINICS[i].kind === 'mental_health')
        .map((r) => r.id),
    );
    for (const row of buildOrgUnitRows()) {
      expect(mentalHealthClinicIds.has(row.clinic_id)).toBe(true);
    }
  });

  it('is byte-stable across calls', () => {
    expect(buildOrgUnitRows()).toStrictEqual(buildOrgUnitRows());
  });
});

describe('seed-good-health generator 01: program rows', () => {
  it('emits program per (clinic, team) per catalog entry', () => {
    const rows = buildProgramRows();
    // Programs per mental health clinic = sum of teamSlugs lengths.
    const perClinic = PROGRAMS.reduce((s, p) => s + p.teamSlugs.length, 0);
    expect(rows).toHaveLength(MENTAL_HEALTH_CLINICS.length * perClinic);
  });

  it('every program row references an org_unit_id emitted by org_unit generator', () => {
    const orgUnitIds = new Set(buildOrgUnitRows().map((r) => r.id));
    for (const row of buildProgramRows()) {
      expect(orgUnitIds.has(row.org_unit_id)).toBe(true);
    }
  });

  it('is byte-stable across calls', () => {
    expect(buildProgramRows()).toStrictEqual(buildProgramRows());
  });
});

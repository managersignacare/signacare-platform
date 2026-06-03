import { describe, it, expect } from 'vitest';
import { buildDepartmentHeads } from '../src/seed-good-health/generators/03_department_heads';
import { stubHash } from '../src/seed-good-health/generators/02_executive_staff';
import { DEPARTMENT_HEADS } from '../src/seed-good-health/config/catalog';
import { clinicId } from '../src/seed-good-health/config/ids';

const SPECIALTY_CODES = new Set([
  'mental_health',
  'general_medicine',
  'endocrinology',
  'paediatrics',
  'obstetrics_gynaecology',
  'surgery',
  'oncology',
]);

describe('seed-good-health generator 03: department heads', () => {
  it('emits one staff row per catalog HOD', async () => {
    const { staffRows } = await buildDepartmentHeads(stubHash);
    expect(staffRows).toHaveLength(DEPARTMENT_HEADS.length);
    expect(staffRows.length).toBe(7);
  });

  it('emits one staff_specialties row per HOD, all is_primary=true', async () => {
    const { specialtyRows } = await buildDepartmentHeads(stubHash);
    expect(specialtyRows).toHaveLength(DEPARTMENT_HEADS.length);
    for (const row of specialtyRows) {
      expect(row.is_primary).toBe(true);
    }
  });

  it('every HOD anchors to the executive clinic tenant', async () => {
    const { staffRows, specialtyRows } = await buildDepartmentHeads(stubHash);
    const exec = clinicId('executive');
    for (const row of staffRows) {
      expect(row.clinic_id).toBe(exec);
    }
    for (const row of specialtyRows) {
      expect(row.clinic_id).toBe(exec);
    }
  });

  it('specialty_code values all exist in the canonical specialty set', async () => {
    const { specialtyRows } = await buildDepartmentHeads(stubHash);
    for (const row of specialtyRows) {
      expect(SPECIALTY_CODES.has(row.specialty_code)).toBe(true);
    }
  });

  it('each specialty_code appears exactly once across the 7 HODs', async () => {
    const { specialtyRows } = await buildDepartmentHeads(stubHash);
    const seen = new Set(specialtyRows.map((r) => r.specialty_code));
    expect(seen.size).toBe(specialtyRows.length);
  });

  it('staff_specialties.staff_id always references a row emitted by this build', async () => {
    const { staffRows, specialtyRows } = await buildDepartmentHeads(stubHash);
    const staffIds = new Set(staffRows.map((r) => r.id));
    for (const row of specialtyRows) {
      expect(staffIds.has(row.staff_id)).toBe(true);
    }
  });

  it('every HOD row has role=admin', async () => {
    const { staffRows } = await buildDepartmentHeads(stubHash);
    for (const row of staffRows) {
      expect(row.role).toBe('admin');
    }
  });

  it('ids are byte-stable across two builds (idempotency proof)', async () => {
    const a = await buildDepartmentHeads(stubHash);
    const b = await buildDepartmentHeads(stubHash);
    expect(a.staffRows.map((r) => r.id)).toStrictEqual(
      b.staffRows.map((r) => r.id),
    );
    expect(a.specialtyRows.map((r) => r.id)).toStrictEqual(
      b.specialtyRows.map((r) => r.id),
    );
  });

  it('login table matches staff row count and rolls role=admin', async () => {
    const { staffRows, loginTable } = await buildDepartmentHeads(stubHash);
    expect(loginTable).toHaveLength(staffRows.length);
    for (const row of loginTable) {
      expect(row.role).toBe('admin');
      expect(row.plainPassword).toMatch(/2026$/);
    }
  });

  it('emails are unique and in exec.goodhealth.demo domain', async () => {
    const { staffRows } = await buildDepartmentHeads(stubHash);
    const emails = new Set(staffRows.map((r) => r.email));
    expect(emails.size).toBe(staffRows.length);
    for (const row of staffRows) {
      expect(row.email).toMatch(/^[a-z.]+@exec\.goodhealth\.demo$/);
    }
  });
});

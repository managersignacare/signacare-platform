import { describe, it, expect } from 'vitest';
import { buildClinicStaff } from '../src/seed-good-health/generators/04_clinic_staff';
import { stubHash } from '../src/seed-good-health/generators/02_executive_staff';
import {
  MENTAL_HEALTH_CLINICS,
  TEAM_SLUGS,
  CLINIC_ROLE_ROSTER,
} from '../src/seed-good-health/config/catalog';
import { clinicId } from '../src/seed-good-health/config/ids';

const EXPECTED_COUNT =
  MENTAL_HEALTH_CLINICS.length * TEAM_SLUGS.length * CLINIC_ROLE_ROSTER.length;

describe('seed-good-health generator 04: clinic staff', () => {
  it('emits exactly 80 staff rows (4 clinics × 2 teams × 10 slots)', async () => {
    const { staffRows } = await buildClinicStaff(stubHash);
    expect(staffRows).toHaveLength(EXPECTED_COUNT);
    expect(staffRows.length).toBe(80);
  });

  it('emits one staff_specialties row per staff row', async () => {
    const { staffRows, specialtyRows } = await buildClinicStaff(stubHash);
    expect(specialtyRows).toHaveLength(staffRows.length);
    for (const row of specialtyRows) {
      expect(row.specialty_code).toBe('mental_health');
      expect(row.is_primary).toBe(true);
    }
  });

  it('every staff row is RLS-scoped to one of the 4 MH clinics', async () => {
    const { staffRows } = await buildClinicStaff(stubHash);
    const mhClinicIds = new Set(
      MENTAL_HEALTH_CLINICS.map((c) => clinicId(c.slug)),
    );
    for (const row of staffRows) {
      expect(mhClinicIds.has(row.clinic_id)).toBe(true);
    }
  });

  it('each clinic has exactly 20 staff (2 teams × 10 roster)', async () => {
    const { staffRows } = await buildClinicStaff(stubHash);
    const counts = new Map<string, number>();
    for (const row of staffRows) {
      counts.set(row.clinic_id, (counts.get(row.clinic_id) ?? 0) + 1);
    }
    expect(counts.size).toBe(MENTAL_HEALTH_CLINICS.length);
    for (const [, count] of counts) {
      expect(count).toBe(20);
    }
  });

  it('all 80 staff ids are distinct', async () => {
    const { staffRows } = await buildClinicStaff(stubHash);
    const ids = new Set(staffRows.map((r) => r.id));
    expect(ids.size).toBe(80);
  });

  it('emails are unique within each clinic tenant', async () => {
    const { staffRows } = await buildClinicStaff(stubHash);
    const byClinic = new Map<string, Set<string>>();
    for (const row of staffRows) {
      if (!byClinic.has(row.clinic_id)) byClinic.set(row.clinic_id, new Set());
      const set = byClinic.get(row.clinic_id)!;
      expect(set.has(row.email)).toBe(false);
      set.add(row.email);
    }
  });

  it('role mix per team matches the roster (9 clinician + 1 receptionist)', async () => {
    const { staffRows } = await buildClinicStaff(stubHash);
    const clinicianCount = staffRows.filter((r) => r.role === 'clinician').length;
    const receptionistCount = staffRows.filter((r) => r.role === 'receptionist').length;
    // 9 clinician slots + 1 admin receptionist slot × 8 teams = 72 + 8
    expect(clinicianCount).toBe(72);
    expect(receptionistCount).toBe(8);
  });

  it('ids are byte-stable across two builds (idempotency proof)', async () => {
    const a = await buildClinicStaff(stubHash);
    const b = await buildClinicStaff(stubHash);
    expect(a.staffRows.map((r) => r.id)).toStrictEqual(
      b.staffRows.map((r) => r.id),
    );
    expect(a.staffRows.map((r) => `${r.given_name}|${r.family_name}`)).toStrictEqual(
      b.staffRows.map((r) => `${r.given_name}|${r.family_name}`),
    );
  });

  it('login table row count matches staff row count and carries plain passwords', async () => {
    const { staffRows, loginTable } = await buildClinicStaff(stubHash);
    expect(loginTable).toHaveLength(staffRows.length);
    for (const row of loginTable) {
      expect(row.plainPassword.length).toBeGreaterThanOrEqual(8);
      expect(row.plainPassword).toMatch(/2026$/);
    }
  });

  it('every specialty row references a staff row in the same build', async () => {
    const { staffRows, specialtyRows } = await buildClinicStaff(stubHash);
    const staffIds = new Set(staffRows.map((r) => r.id));
    for (const row of specialtyRows) {
      expect(staffIds.has(row.staff_id)).toBe(true);
      expect(row.clinic_id).toBe(
        staffRows.find((r) => r.id === row.staff_id)!.clinic_id,
      );
    }
  });
});

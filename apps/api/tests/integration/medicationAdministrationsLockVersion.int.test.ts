/**
 * BUG-PR-R1-12-FIX-S0-medication_administrations regression.
 *
 * Sibling pattern of BUG-371a + BUG-402 + BUG-564. Today no UPDATE path
 * exists on `medication_administrations` (the table is INSERT-only via
 * the nurseFeatureRoutes MAR write path). The fix is preventive — adding
 * `lock_version` so any future UPDATE author MUST route through
 * `updateWithOptimisticLock`. S0 per L4 grading: LAI/PRN double-
 * administration race is a patient-harm class.
 *
 * Coverage (5 tests):
 *   T1 — DB column exists with NOT NULL + DEFAULT 1
 *   T2 — Mapper surfaces lock_version → response.lockVersion
 *   T3 — MEDICATION_ADMINISTRATION_COLUMNS array includes lock_version
 *   T4 — CLAUDE.md §1.6 roster lists medication_administrations
 *   T5 — GET /medication-administrations read route exists with
 *        CLINICAL_ROLES + query-schema parse guard
 */

import { describe, it, expect } from 'vitest';
import { isIntegrationReady } from './_helpers';

describe.skipIf(!(await isIntegrationReady()))('BUG-PR-R1-12-FIX-S0-medication_administrations opt-locking', () => {
  // ── T1 ──
  it('T1: DB column lock_version exists NOT NULL DEFAULT 1', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const meta = await dbAdmin.raw(
      `SELECT column_name, is_nullable, column_default, data_type
       FROM information_schema.columns
       WHERE table_name = 'medication_administrations' AND column_name = 'lock_version'`,
    );
    const row = meta.rows?.[0] as
      | { column_name: string; is_nullable: string; column_default: string; data_type: string }
      | undefined;
    expect(row).toBeTruthy();
    expect(row!.is_nullable).toBe('NO');
    expect(row!.column_default).toMatch(/^1\b/);
    expect(row!.data_type).toBe('integer');
  });

  // ── T2 ──
  it('T2: mapMedicationAdministrationRowToResponse surfaces lockVersion', async () => {
    const { mapMedicationAdministrationRowToResponse } = await import(
      '../../src/features/roles/medicationAdministrationMapper'
    );
    const result = mapMedicationAdministrationRowToResponse({
      id: '00000000-0000-0000-0000-000000000001',
      clinic_id: '00000000-0000-0000-0000-000000000002',
      patient_id: '00000000-0000-0000-0000-000000000003',
      patient_medication_id: '00000000-0000-0000-0000-000000000004',
      scheduled_time: null,
      status: 'given',
      administered_time: null,
      administered_by_staff_id: null,
      dose_given: null,
      route: null,
      site: null,
      notes: null,
      reason_not_given: null,
      witnessed_by_staff_id: null,
      batch_number: null,
      administration_context: null,
      prn_reason: null,
      created_at: '2026-05-01T00:00:00.000Z',
      lock_version: 1,
    });
    expect(result.lockVersion).toBe(1);
  });

  // ── T3 ──
  it('T3: MEDICATION_ADMINISTRATION_COLUMNS array includes lock_version', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(__dirname, '..', '..', 'src', 'features', 'roles', 'nurseFeatureRoutes.ts'),
      'utf-8',
    );
    const arrIdx = src.indexOf('const MEDICATION_ADMINISTRATION_COLUMNS = [');
    expect(arrIdx).toBeGreaterThan(-1);
    // Capture the array literal
    const arrEnd = src.indexOf('] as const;', arrIdx);
    const arrBlock = src.slice(arrIdx, arrEnd);
    expect(arrBlock).toMatch(/'lock_version'/);
  });

  // ── T4 ──
  it('T4: CLAUDE.md §1.6 roster lists medication_administrations', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const repoRoot = resolve(__dirname, '..', '..', '..', '..');
    const claudeMd = readFileSync(resolve(repoRoot, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toMatch(/medication_administrations.*BUG-PR-R1-12-FIX-S0-medication_administrations/);
  });

  // ── T5 ──
  it('T5: GET /medication-administrations route is present + clinically scoped', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(__dirname, '..', '..', 'src', 'features', 'roles', 'nurseFeatureRoutes.ts'),
      'utf-8',
    );
    expect(src).toMatch(/router\.get\(\s*'\/medication-administrations'/);
    expect(src).toMatch(/requireRoles\(\[\.\.\.CLINICAL_ROLES\]\)/);
    expect(src).toMatch(/MedicationAdministrationsQuerySchema\.parse\(req\.query\)/);
  });
});

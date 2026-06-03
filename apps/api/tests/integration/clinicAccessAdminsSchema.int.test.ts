/**
 * BUG-349 / Phase 0.5.A — clinics.nominated_admin_staff_id +
 * clinics.delegated_admin_staff_id schema.
 *
 * Foundation commit for the three-layer access model (PART 12). Two
 * nullable FK columns carry the "access administrator" + "delegate"
 * per subscribing organisation. Default NULL (strict transition —
 * until a superadmin populates these per clinic, no clinic admin can
 * change access settings; only superadmin can).
 *
 * Coverage:
 *   T1 — both columns exist with correct type + nullability + FK to
 *        staff(id) with ON DELETE SET NULL, plus the indexes on each
 *   T2 — CHECK constraint clinics_access_admin_distinct rejects
 *        identical values in both slots; accepts (NULL, NULL),
 *        (staffA, NULL), (NULL, staffB), (staffA, staffB) where
 *        staffA != staffB.
 *   T3 — snapshot-freshness proof: schema-snapshot.json lists both
 *        new columns under `clinics` (pinned so the snapshot refresh
 *        ships in the same commit).
 *   T4 — L3-absorb-1 behavioural FK test: when a referenced staff
 *        row is deleted, the slot on clinics is set to NULL (proving
 *        ON DELETE SET NULL fires at runtime, not just in metadata).
 *   T5 — L3-absorb-1 cross-clinic containment: attempting to set
 *        nominated_admin_staff_id to a staff member of a DIFFERENT
 *        clinic is rejected by the
 *        clinics_access_admin_same_clinic_check trigger.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('Phase 0.5.A clinics.{nominated,delegated}_admin_staff_id schema', () => {
  let clinicId: string;
  let seededStaffAId: string;
  let seededStaffBId: string;

  beforeAll(async () => {
    const session = await loginAsAdmin();
    clinicId = session.clinicId;
    const { dbAdmin } = await import('../../src/db/db');

    // Seed two distinct staff we can use in CHECK-constraint tests.
    seededStaffAId = randomUUID();
    seededStaffBId = randomUUID();
    await dbAdmin('staff').insert([
      {
        id: seededStaffAId, clinic_id: clinicId,
        email: `test-schema-a-${seededStaffAId.slice(0, 6)}@signacare.local`,
        password_hash: 'stub', given_name: 'SchemaTest', family_name: 'A',
        role: 'admin', is_active: true,
      },
      {
        id: seededStaffBId, clinic_id: clinicId,
        email: `test-schema-b-${seededStaffBId.slice(0, 6)}@signacare.local`,
        password_hash: 'stub', given_name: 'SchemaTest', family_name: 'B',
        role: 'admin', is_active: true,
      },
    ]);
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    // Clear any assignment we made before deleting staff rows (FK SET NULL
    // would handle it but explicit is safer for assertion isolation).
    await dbAdmin('clinics').where({ id: clinicId })
      .update({ nominated_admin_staff_id: null, delegated_admin_staff_id: null });
    await dbAdmin('staff').whereIn('id', [seededStaffAId, seededStaffBId]).delete();
  });

  it('T1 — both columns exist, nullable, FK to staff(id) ON DELETE SET NULL, indexed', async () => {
    const { dbAdmin } = await import('../../src/db/db');

    const colInfo = await dbAdmin.raw(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'clinics'
        AND column_name IN ('nominated_admin_staff_id', 'delegated_admin_staff_id')
      ORDER BY column_name
    `);
    const cols = colInfo.rows as Array<{ column_name: string; data_type: string; is_nullable: string }>;
    expect(cols).toHaveLength(2);
    for (const c of cols) {
      expect(c.data_type).toBe('uuid');
      expect(c.is_nullable).toBe('YES');
    }

    const fkInfo = await dbAdmin.raw(`
      SELECT kcu.column_name, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
      WHERE tc.table_name = 'clinics'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name IN ('nominated_admin_staff_id', 'delegated_admin_staff_id')
      ORDER BY kcu.column_name
    `);
    const fks = fkInfo.rows as Array<{ column_name: string; delete_rule: string }>;
    expect(fks).toHaveLength(2);
    for (const fk of fks) {
      expect(fk.delete_rule).toBe('SET NULL');
    }

    const idxInfo = await dbAdmin.raw(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'clinics'
        AND (indexdef ILIKE '%nominated_admin_staff_id%'
             OR indexdef ILIKE '%delegated_admin_staff_id%')
    `);
    const idxNames = (idxInfo.rows as Array<{ indexname: string }>).map(r => r.indexname);
    // At least two indexes (one per new column)
    expect(idxNames.length).toBeGreaterThanOrEqual(2);
  });

  it('T2 — clinics_access_admin_distinct CHECK rejects duplicates; accepts distinct / NULL', async () => {
    const { dbAdmin } = await import('../../src/db/db');

    // (NULL, NULL) — accepted
    await expect(
      dbAdmin('clinics').where({ id: clinicId })
        .update({ nominated_admin_staff_id: null, delegated_admin_staff_id: null })
    ).resolves.not.toThrow();

    // (A, NULL) — accepted
    await expect(
      dbAdmin('clinics').where({ id: clinicId })
        .update({ nominated_admin_staff_id: seededStaffAId, delegated_admin_staff_id: null })
    ).resolves.not.toThrow();

    // (NULL, B) — accepted (reset then assign)
    await dbAdmin('clinics').where({ id: clinicId })
      .update({ nominated_admin_staff_id: null });
    await expect(
      dbAdmin('clinics').where({ id: clinicId })
        .update({ delegated_admin_staff_id: seededStaffBId })
    ).resolves.not.toThrow();

    // (A, B) — distinct, accepted
    await expect(
      dbAdmin('clinics').where({ id: clinicId })
        .update({ nominated_admin_staff_id: seededStaffAId, delegated_admin_staff_id: seededStaffBId })
    ).resolves.not.toThrow();

    // (A, A) — duplicate, rejected
    await expect(
      dbAdmin('clinics').where({ id: clinicId })
        .update({ nominated_admin_staff_id: seededStaffAId, delegated_admin_staff_id: seededStaffAId })
    ).rejects.toThrow(/clinics_access_admin_distinct/);
  });

  it('T3 — schema-snapshot.json lists both new columns under clinics (freshness pinned)', () => {
    const snapshotPath = join(
      __dirname, '..', '..', 'src', 'db', 'schema-snapshot.json',
    );
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
    const cols: string[] = snapshot.tables?.clinics ?? [];
    expect(cols).toContain('nominated_admin_staff_id');
    expect(cols).toContain('delegated_admin_staff_id');
  });

  it('T4 — L3-absorb-1: FK ON DELETE SET NULL fires at runtime when staff deleted', async () => {
    const { dbAdmin } = await import('../../src/db/db');

    // Seed a disposable staff row and nominate them, then delete the row.
    const disposableStaffId = randomUUID();
    await dbAdmin('staff').insert({
      id: disposableStaffId, clinic_id: clinicId,
      email: `test-fk-${disposableStaffId.slice(0, 6)}@signacare.local`,
      password_hash: 'stub', given_name: 'FK', family_name: 'Test',
      role: 'admin', is_active: true,
    });
    // Clear any existing assignment, then assign this disposable staff.
    await dbAdmin('clinics').where({ id: clinicId })
      .update({ nominated_admin_staff_id: null, delegated_admin_staff_id: null });
    await dbAdmin('clinics').where({ id: clinicId })
      .update({ nominated_admin_staff_id: disposableStaffId });
    expect((await dbAdmin('clinics').where({ id: clinicId }).first()).nominated_admin_staff_id).toBe(disposableStaffId);

    // Delete the staff row — FK ON DELETE SET NULL should clear the slot.
    await dbAdmin('staff').where({ id: disposableStaffId }).delete();

    const row = await dbAdmin('clinics').where({ id: clinicId }).first();
    expect(row.nominated_admin_staff_id).toBeNull();
  });

  it('T5 — L3-absorb-1: cross-clinic containment trigger rejects foreign-clinic staff', async () => {
    const { dbAdmin } = await import('../../src/db/db');

    // Find (or create) a SECOND clinic distinct from the test clinic.
    const otherClinicRow = await dbAdmin('clinics').whereNot({ id: clinicId }).first();
    let cleanupOtherClinic = false;
    let otherClinicId: string;
    if (!otherClinicRow) {
      otherClinicId = randomUUID();
      await dbAdmin('clinics').insert({
        id: otherClinicId, name: 'Cross-clinic containment test',
      });
      cleanupOtherClinic = true;
    } else {
      otherClinicId = otherClinicRow.id;
    }

    // Seed a staff member in the OTHER clinic.
    const foreignStaffId = randomUUID();
    await withTenantContext(otherClinicId, async () => {
      await dbAdmin('staff').insert({
        id: foreignStaffId, clinic_id: otherClinicId,
        email: `test-cc-${foreignStaffId.slice(0, 6)}@signacare.local`,
        password_hash: 'stub', given_name: 'Foreign', family_name: 'Staff',
        role: 'admin', is_active: true,
      });
    });

    // Attempt to set the foreign staff as nominated_admin of the test clinic.
    // Trigger MUST reject.
    await expect(
      dbAdmin('clinics').where({ id: clinicId })
        .update({ nominated_admin_staff_id: foreignStaffId })
    ).rejects.toThrow(/must reference a staff member of this clinic/);

    // Same for delegated slot.
    await expect(
      dbAdmin('clinics').where({ id: clinicId })
        .update({ delegated_admin_staff_id: foreignStaffId })
    ).rejects.toThrow(/must reference a staff member of this clinic/);

    // Cleanup
    await withTenantContext(otherClinicId, async () => {
      await dbAdmin('staff').where({ id: foreignStaffId }).delete();
    });
    if (cleanupOtherClinic) {
      await dbAdmin('clinics').where({ id: otherClinicId }).delete();
    }
  });
});

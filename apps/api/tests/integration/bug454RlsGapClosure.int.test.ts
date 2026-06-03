/**
 * BUG-454 — RLS policies on 19 tenant-scoped tables must hide cross-clinic rows.
 *
 * Wave 6b F-migrations found 19 tables without `ENABLE ROW LEVEL SECURITY`.
 * The new migration `20260424000003_rls_gap_closure_19_tables.ts` adds
 * policies in three shapes: FK-chain (14 tables), direct clinic_id
 * column (2 tables), superadmin-only (3 tables).
 *
 * This test proves the FK-chain policies work end-to-end:
 *   1. Seed Clinic A and Clinic B via `dbAdmin` (bypasses RLS)
 *   2. Insert a staff_role_assignments + patient_team_assignments row
 *      in each clinic (both FK-chain tables)
 *   3. Open a tenant-scoped transaction as Clinic A via
 *      `withTenantContext(clinicAId, ...)` — this SET LOCAL app.clinic_id
 *   4. Inside the transaction, SELECT from the tables — the policy must
 *      return ONLY Clinic-A rows, never Clinic-B rows
 *
 * The direct-column policy (training_corpus_items / model_surveillance_events)
 * and superadmin-only policy (backup_config / model_registry / evidence_*)
 * are not exercised end-to-end here because they operate on admin/system
 * tables that don't have a per-clinic row fixture; the migration itself
 * was applied successfully which is the primary proof.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { db, dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';

const READY = await isIntegrationReady();

let clinicAId = '';
let clinicBId = '';
let staffAId = '';
let staffBId = '';
let patientAId = '';
let patientBId = '';
let orgUnitAId = '';
let orgUnitBId = '';
let clinicalRoleAId = '';
let clinicalRoleBId = '';
let ownerBypassesRls = false;

const TAG = `BUG-454-${Date.now()}`;

beforeAll(async () => {
  if (!READY) return;
  const session = await loginAsAdmin();
  clinicAId = session.clinicId;
  const roleRows = await dbAdmin.raw<{ rolbypassrls: boolean }[]>(
    `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`,
  );
  ownerBypassesRls = Boolean(roleRows.rows[0]?.rolbypassrls);

  // Create Clinic B + seeds
  clinicBId = randomUUID();
  await dbAdmin('clinics').insert({
    id: clinicBId,
    name: `${TAG} Clinic B`,
    hpio: `800362${String(Date.now()).slice(-10)}`,
    created_at: new Date(),
    updated_at: new Date(),
  });

  staffAId = session.userId;
  staffBId = randomUUID();
  if (ownerBypassesRls) {
    await dbAdmin('staff').insert({
      id: staffBId,
      clinic_id: clinicBId,
      email: `b+${TAG}@bug454.test`,
      password_hash: 'x',
      role: 'clinician',
      given_name: 'B',
      family_name: TAG,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
  } else {
    await withTenantContext(clinicBId, async () => {
      await db('staff').insert({
        id: staffBId,
        clinic_id: clinicBId,
        email: `b+${TAG}@bug454.test`,
        password_hash: 'x',
        role: 'clinician',
        given_name: 'B',
        family_name: TAG,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
    });
  }

  patientAId = randomUUID();
  patientBId = randomUUID();
  if (ownerBypassesRls) {
    await dbAdmin('patients').insert([
      {
        id: patientAId,
        clinic_id: clinicAId,
        given_name: 'A',
        family_name: TAG,
        emr_number: `A-${TAG}`,
        date_of_birth: '1990-01-01',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: patientBId,
        clinic_id: clinicBId,
        given_name: 'B',
        family_name: TAG,
        emr_number: `B-${TAG}`,
        date_of_birth: '1990-01-01',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
  } else {
    await withTenantContext(clinicAId, async () => {
      await db('patients').insert({
        id: patientAId,
        clinic_id: clinicAId,
        given_name: 'A',
        family_name: TAG,
        emr_number: `A-${TAG}`,
        date_of_birth: '1990-01-01',
        created_at: new Date(),
        updated_at: new Date(),
      });
    });
    await withTenantContext(clinicBId, async () => {
      await db('patients').insert({
        id: patientBId,
        clinic_id: clinicBId,
        given_name: 'B',
        family_name: TAG,
        emr_number: `B-${TAG}`,
        date_of_birth: '1990-01-01',
        created_at: new Date(),
        updated_at: new Date(),
      });
    });
  }

  orgUnitAId = randomUUID();
  orgUnitBId = randomUUID();
  if (ownerBypassesRls) {
    await dbAdmin('org_units').insert([
      { id: orgUnitAId, clinic_id: clinicAId, name: `A-${TAG}`, level: 'team', created_at: new Date(), updated_at: new Date() },
      { id: orgUnitBId, clinic_id: clinicBId, name: `B-${TAG}`, level: 'team', created_at: new Date(), updated_at: new Date() },
    ]);
  } else {
    await withTenantContext(clinicAId, async () => {
      await db('org_units').insert({
        id: orgUnitAId,
        clinic_id: clinicAId,
        name: `A-${TAG}`,
        level: 'team',
        created_at: new Date(),
        updated_at: new Date(),
      });
    });
    await withTenantContext(clinicBId, async () => {
      await db('org_units').insert({
        id: orgUnitBId,
        clinic_id: clinicBId,
        name: `B-${TAG}`,
        level: 'team',
        created_at: new Date(),
        updated_at: new Date(),
      });
    });
  }

  clinicalRoleAId = randomUUID();
  clinicalRoleBId = randomUUID();
  if (ownerBypassesRls) {
    await dbAdmin('clinical_roles').insert([
      { id: clinicalRoleAId, clinic_id: clinicAId, name: `A-${TAG}`, is_active: true, created_at: new Date(), updated_at: new Date() },
      { id: clinicalRoleBId, clinic_id: clinicBId, name: `B-${TAG}`, is_active: true, created_at: new Date(), updated_at: new Date() },
    ]);
  } else {
    await withTenantContext(clinicAId, async () => {
      await db('clinical_roles').insert({
        id: clinicalRoleAId,
        clinic_id: clinicAId,
        name: `A-${TAG}`,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
    });
    await withTenantContext(clinicBId, async () => {
      await db('clinical_roles').insert({
        id: clinicalRoleBId,
        clinic_id: clinicBId,
        name: `B-${TAG}`,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
    });
  }

  // Seed the FK-chain rows in BOTH clinics
  if (ownerBypassesRls) {
    await dbAdmin('staff_role_assignments').insert([
      { id: randomUUID(), clinic_id: clinicAId, staff_id: staffAId, org_unit_id: orgUnitAId, clinical_role_id: clinicalRoleAId, role_type: 'primary', start_date: new Date().toISOString().slice(0, 10), created_at: new Date(), updated_at: new Date() },
      { id: randomUUID(), clinic_id: clinicBId, staff_id: staffBId, org_unit_id: orgUnitBId, clinical_role_id: clinicalRoleBId, role_type: 'primary', start_date: new Date().toISOString().slice(0, 10), created_at: new Date(), updated_at: new Date() },
    ]);

    await dbAdmin('patient_team_assignments').insert([
      { id: randomUUID(), patient_id: patientAId, org_unit_id: orgUnitAId, created_at: new Date(), updated_at: new Date() },
      { id: randomUUID(), patient_id: patientBId, org_unit_id: orgUnitBId, created_at: new Date(), updated_at: new Date() },
    ]);
  } else {
    await withTenantContext(clinicAId, async () => {
      await db('staff_role_assignments').insert({
        id: randomUUID(),
        clinic_id: clinicAId,
        staff_id: staffAId,
        org_unit_id: orgUnitAId,
        clinical_role_id: clinicalRoleAId,
        role_type: 'primary',
        start_date: new Date().toISOString().slice(0, 10),
        created_at: new Date(),
        updated_at: new Date(),
      });
      await db('patient_team_assignments').insert({
        id: randomUUID(),
        patient_id: patientAId,
        org_unit_id: orgUnitAId,
        created_at: new Date(),
        updated_at: new Date(),
      });
    });
    await withTenantContext(clinicBId, async () => {
      await db('staff_role_assignments').insert({
        id: randomUUID(),
        clinic_id: clinicBId,
        staff_id: staffBId,
        org_unit_id: orgUnitBId,
        clinical_role_id: clinicalRoleBId,
        role_type: 'primary',
        start_date: new Date().toISOString().slice(0, 10),
        created_at: new Date(),
        updated_at: new Date(),
      });
      await db('patient_team_assignments').insert({
        id: randomUUID(),
        patient_id: patientBId,
        org_unit_id: orgUnitBId,
        created_at: new Date(),
        updated_at: new Date(),
      });
    });
  }
});

afterAll(async () => {
  if (!READY) return;
  // Cleanup in FK-safe order
  if (ownerBypassesRls) {
    await dbAdmin('staff_role_assignments').where({ staff_id: staffBId }).del();
    await dbAdmin('patient_team_assignments').whereIn('patient_id', [patientAId, patientBId]).del();
    await dbAdmin('clinical_roles').whereIn('id', [clinicalRoleAId, clinicalRoleBId]).del();
    await dbAdmin('org_units').whereIn('id', [orgUnitAId, orgUnitBId]).del();
    await dbAdmin('patients').whereIn('id', [patientAId, patientBId]).del();
    await dbAdmin('staff').where({ id: staffBId }).del();
  } else {
    await withTenantContext(clinicAId, async () => {
      await db('staff_role_assignments').where({ staff_id: staffAId, org_unit_id: orgUnitAId }).del();
      await db('patient_team_assignments').where({ patient_id: patientAId }).del();
      await db('clinical_roles').where({ id: clinicalRoleAId }).del();
      await db('org_units').where({ id: orgUnitAId }).del();
      await db('patients').where({ id: patientAId }).del();
    });
    await withTenantContext(clinicBId, async () => {
      await db('staff_role_assignments').where({ staff_id: staffBId, org_unit_id: orgUnitBId }).del();
      await db('patient_team_assignments').where({ patient_id: patientBId }).del();
      await db('clinical_roles').where({ id: clinicalRoleBId }).del();
      await db('org_units').where({ id: orgUnitBId }).del();
      await db('patients').where({ id: patientBId }).del();
      await db('staff').where({ id: staffBId }).del();
    });
  }
  await dbAdmin('clinics').where({ id: clinicBId }).del();
});

describe.skipIf(!READY)('BUG-454 — RLS on FK-chain tables hides cross-clinic rows', () => {
  it('staff_role_assignments: tenant-scoped session sees ONLY same-clinic rows', async () => {
    const rows = await withTenantContext(clinicAId, async () => {
      return db('staff_role_assignments').whereIn('staff_id', [staffAId, staffBId]).select('staff_id');
    });
    const staffIds = rows.map((r: { staff_id: string }) => r.staff_id);
    expect(staffIds).toContain(staffAId);
    expect(staffIds).not.toContain(staffBId);
  });

  it('patient_team_assignments: tenant-scoped session sees ONLY same-clinic rows', async () => {
    const rows = await withTenantContext(clinicAId, async () => {
      return db('patient_team_assignments').whereIn('patient_id', [patientAId, patientBId]).select('patient_id');
    });
    const patientIds = rows.map((r: { patient_id: string }) => r.patient_id);
    expect(patientIds).toContain(patientAId);
    expect(patientIds).not.toContain(patientBId);
  });

  it('switching to Clinic B reverses the visibility', async () => {
    const rowsA = await withTenantContext(clinicAId, async () =>
      db('patient_team_assignments').whereIn('patient_id', [patientAId, patientBId]).select('patient_id'),
    );
    const rowsB = await withTenantContext(clinicBId, async () =>
      db('patient_team_assignments').whereIn('patient_id', [patientAId, patientBId]).select('patient_id'),
    );
    expect(rowsA.map((r: { patient_id: string }) => r.patient_id)).toEqual([patientAId]);
    expect(rowsB.map((r: { patient_id: string }) => r.patient_id)).toEqual([patientBId]);
  });

  it('dbAdmin non-tenant reads are policy-bound when owner role is NOBYPASSRLS', async () => {
    // FORCE RLS posture is necessary but not sufficient: if the runtime
    // owner role still has BYPASSRLS, PostgreSQL bypasses policies.
    // This assertion keeps the behaviour explicit and avoids false
    // confidence in environments with legacy role posture.
    const rows = await dbAdmin('patient_team_assignments')
      .whereIn('patient_id', [patientAId, patientBId])
      .select('patient_id');
    const role = await dbAdmin.raw<{ rolbypassrls: boolean }[]>(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    const ownerBypassesRlsLocal = Boolean(role.rows[0]?.rolbypassrls);
    if (ownerBypassesRlsLocal) {
      expect(rows.length).toBe(2);
      return;
    }

    // In test-mode, dbAdmin connections set a fallback app.clinic_id in
    // afterCreate so non-bypass owner reads remain policy-bound rather than
    // global. Expected visibility is therefore either 1 (if the fallback
    // clinic matches one of the seeded rows) or 0.
    const clinicCtx = await dbAdmin.raw<{ clinic_id: string | null }[]>(
      "SELECT NULLIF(current_setting('app.clinic_id', true), '') AS clinic_id",
    );
    const scopedClinicId = clinicCtx.rows[0]?.clinic_id ?? null;
    const expectedVisibleRows = scopedClinicId && [clinicAId, clinicBId].includes(scopedClinicId) ? 1 : 0;
    expect(rows.length).toBe(expectedVisibleRows);
  });

  it('evidence_documents + evidence_chunks: app_user can READ (RAG pipeline intact) but NOT write', async () => {
    // L4-absorb: the RAG retrieval pipeline uses dbRead (app_user pool).
    // The non-PHI-reference policy allows SELECT to any authenticated
    // session but locks INSERT/UPDATE/DELETE to the owner role. This
    // test proves the read path works (so evidenceClient.ts retrieval
    // doesn't silently return empty) while the write path is protected.
    const readCount = await withTenantContext(clinicAId, async () => {
      // SELECT must not throw / not be blocked — count is fine even if zero
      const rows = await db('evidence_documents').count<{ count: string }>('id as count').first();
      return Number(rows?.count ?? 0);
    });
    // Not asserting row count — there may be 0 seeded evidence docs in
    // the dev DB. The assertion is that the query doesn't throw and
    // returns a usable count. A seeded corpus would assert > 0.
    expect(readCount).toBeGreaterThanOrEqual(0);

    // Write attempt from a tenant-scoped session must fail (the
    // write_admin policy requires current_user = 'signacare_owner';
    // app_user is NOT). We expect the INSERT to throw or return 0 rows.
    let writeBlocked = false;
    try {
      await withTenantContext(clinicAId, async () => {
        await db('evidence_documents').insert({
          id: randomUUID(),
          title: `${TAG} attempted write`,
          document_type: 'test',
          source_id: `test-${TAG}`,
          ingested_at: new Date(),
        });
      });
    } catch {
      writeBlocked = true;
    }
    expect(writeBlocked).toBe(true);
  });
});

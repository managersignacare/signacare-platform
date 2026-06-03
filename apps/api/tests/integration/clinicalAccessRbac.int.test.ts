/**
 * Phase 0.5.B — Two-rail access model regression test.
 *
 * Replaces the single BYPASS_ROLES = {superadmin, admin} god-mode
 * with two distinct rails per PART 12 of plans/sleepy-roaming-meteor.md:
 *
 *   Clinical rail (requirePatientRelationship) — caller passes if ANY:
 *     1. Caller is clinics.nominated_admin_staff_id OR
 *        delegated_admin_staff_id for the patient's clinic
 *     2. Episode relationship (primary_clinician_id / key_worker_id)
 *     3. Team relationship via staff_team_assignments OR
 *        staff_role_assignments with recursive hierarchy cascade up
 *        org_units.parent_id
 *     4. Appointment attendee
 *   Role-based bypass is REMOVED — superadmin + generic role='admin'
 *   no longer auto-pass this guard.
 *
 *   Settings rail (requireAccessSettingsAuthority) — caller passes if:
 *     1. auth.role === 'superadmin' (cross-clinic operator)
 *     2. Caller is nominated/delegated for the target clinic
 *   Otherwise 403 ACCESS_SETTINGS_READ_ONLY.
 *
 *   Operational-only roles (receptionist, readonly) always rejected
 *   by requireClinicalAccessRole regardless of team attachments.
 *
 * Coverage (14 tests):
 *   Clinical rail:
 *     T1 clinician with staff_team_assignments on team → 200
 *     T2 team-leader with staff_role_assignments only → 200 (NEW)
 *     T3 executive with staff_role_assignments at parent facility → 200
 *        on patient in grandchild team (NEW, arbitrary cascade)
 *     T4 superadmin accessing clinical data → 403 NO_PATIENT_RELATIONSHIP
 *        (formerly bypassed — NEW)
 *     T5 generic role='admin' (NOT nominated/delegated) → 403
 *        (formerly bypassed — NEW)
 *     T6 nominated_admin_staff_id → 200 (NEW)
 *     T7 delegated_admin_staff_id → 200 (NEW)
 *     T8 receptionist with staff_team_assignments → 403
 *        CLINICAL_ACCESS_DENIED (operational block)
 *     T9 clinician on team A accessing patient in team B → 403 (unchanged)
 *
 *   Settings rail:
 *     T10 nominated admin PUT module-access → 200
 *     T11 delegated admin PUT module-access → 200
 *     T12 non-nominated generic 'admin' PUT → 403
 *         ACCESS_SETTINGS_READ_ONLY
 *     T13 non-nominated generic 'admin' GET → 200 (view-only preserved)
 *     T14 superadmin PUT module-access → 200
 *
 * Executed via direct guard calls (not HTTP) so we can construct
 * AuthContext shapes without spinning up a full session for each
 * persona. HTTP-level assertions for the settings rail are covered
 * in a separate suite (clinicAccessSettingsAuthority.int.test.ts) —
 * this file focuses on the guard semantics.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import type { AuthContext } from '@signacare/shared';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import {
  requirePatientRelationship,
  requireClinicalAccessRole,
  requireAccessSettingsAuthority,
} from '../../src/shared/authGuards';
import { withTenantContext } from '../../src/shared/tenantContext';

const READY = await isIntegrationReady();

function buildAuth(overrides: Partial<AuthContext>): AuthContext {
  return {
    staffId: randomUUID(),
    clinicId: randomUUID(),
    role: 'clinician',
    permissions: [],
    ...overrides,
  };
}

/**
 * Guard calls use the `db` proxy which inherits the RLS transaction
 * from the rlsStore AsyncLocalStorage. Outside a request, no transaction
 * exists → raw pool → RLS active → empty result. Wrap each guard
 * invocation in withTenantContext so app.clinic_id is SET LOCAL and
 * the CTE can see the seeded rows.
 */
async function inTenant<T>(clinicId: string, fn: () => Promise<T>): Promise<T> {
  return withTenantContext(clinicId, fn);
}

describe.skipIf(!READY)('Phase 0.5.B two-rail access model', () => {
  let clinicId: string;
  let otherClinicId: string;
  let facilityOrgUnitId: string;
  let teamAOrgUnitId: string;
  let teamBOrgUnitId: string;
  let grandchildTeamOrgUnitId: string;
  let patientId: string;
  let patientOtherClinicId: string;

  const clinicianOnTeamAId = randomUUID();
  const teamLeaderRoleOnlyId = randomUUID();
  const executiveAtFacilityId = randomUUID();
  const clinicalDirectorId = randomUUID();
  const executiveDirectorId = randomUUID();
  const receptionistOnTeamAId = randomUUID();
  const clinicianOnTeamBId = randomUUID();
  const nominatedAdminId = randomUUID();
  const delegatedAdminId = randomUUID();
  const genericAdminNotNominatedId = randomUUID();
  const superadminId = randomUUID();
  const clinicalRoleName = `Team Leader ${Date.now()}`;
  const clinicalDirectorRoleName = `Clinical Director ${Date.now()}`;
  const executiveDirectorRoleName = `Executive Director ${Date.now()}`;
  let clinicalRoleId: string;
  let clinicalDirectorRoleId: string;
  let executiveDirectorRoleId: string;

  beforeAll(async () => {
    const session = await loginAsAdmin();
    clinicId = session.clinicId;

    const { dbAdmin } = await import('../../src/db/db');

    // Second clinic for cross-tenant scenarios.
    otherClinicId = randomUUID();
    await dbAdmin('clinics').insert({
      id: otherClinicId, name: 'Phase0.5.B other clinic', hpio: `800362${String(Date.now()).slice(-10)}`,
    });

    // Org-unit hierarchy: facility → teamA / teamB; teamA → grandchild
    facilityOrgUnitId = randomUUID();
    teamAOrgUnitId = randomUUID();
    teamBOrgUnitId = randomUUID();
    grandchildTeamOrgUnitId = randomUUID();
    await withTenantContext(clinicId, () =>
      dbAdmin('org_units').insert([
        { id: facilityOrgUnitId, clinic_id: clinicId, name: 'P05B Facility', level: 'facility', parent_id: null },
        { id: teamAOrgUnitId, clinic_id: clinicId, name: 'P05B Team A', level: 'team', parent_id: facilityOrgUnitId },
        { id: teamBOrgUnitId, clinic_id: clinicId, name: 'P05B Team B', level: 'team', parent_id: facilityOrgUnitId },
        { id: grandchildTeamOrgUnitId, clinic_id: clinicId, name: 'P05B Team A Sub', level: 'sub-team', parent_id: teamAOrgUnitId },
      ]),
    );

    // Clinical role for staff_role_assignments tests
    clinicalRoleId = randomUUID();
    clinicalDirectorRoleId = randomUUID();
    executiveDirectorRoleId = randomUUID();
    await withTenantContext(clinicId, () =>
      dbAdmin('clinical_roles').insert([
        {
          id: clinicalRoleId,
          clinic_id: clinicId,
          name: clinicalRoleName,
          is_active: true,
        },
        {
          id: clinicalDirectorRoleId,
          clinic_id: clinicId,
          name: clinicalDirectorRoleName,
          is_active: true,
        },
        {
          id: executiveDirectorRoleId,
          clinic_id: clinicId,
          name: executiveDirectorRoleName,
          is_active: true,
        },
      ]),
    );

    // Staff seed
    const mkStaff = (id: string, role: string, cId = clinicId, email?: string) => ({
      id, clinic_id: cId,
      email: email ?? `p05b-${id.slice(0, 6)}@signacare.local`,
      password_hash: 'stub',
      given_name: 'Test', family_name: id.slice(0, 4),
      role, is_active: true,
    });
    await withTenantContext(clinicId, () =>
      dbAdmin('staff').insert([
        mkStaff(clinicianOnTeamAId, 'clinician'),
        mkStaff(teamLeaderRoleOnlyId, 'clinician'),
        mkStaff(executiveAtFacilityId, 'clinician'),
        mkStaff(clinicalDirectorId, 'clinician'),
        mkStaff(executiveDirectorId, 'clinician'),
        mkStaff(receptionistOnTeamAId, 'receptionist'),
        mkStaff(clinicianOnTeamBId, 'clinician'),
        mkStaff(nominatedAdminId, 'admin'),
        mkStaff(delegatedAdminId, 'admin'),
        mkStaff(genericAdminNotNominatedId, 'admin'),
        // Superadmin nominally belongs to *some* clinic; use this clinic
        mkStaff(superadminId, 'superadmin'),
      ]),
    );

    // Patient in the test clinic, assigned to the grandchild team
    patientId = randomUUID();
    await withTenantContext(clinicId, async () => {
      await dbAdmin('patients').insert({
        id: patientId, clinic_id: clinicId,
        given_name: 'P05B', family_name: 'Patient',
        date_of_birth: '1985-06-12',
      });
      await dbAdmin('patient_team_assignments').insert({
        id: randomUUID(),
        patient_id: patientId,
        org_unit_id: grandchildTeamOrgUnitId,
        is_active: true,
      });
    });

    // Patient in the OTHER clinic (never accessible by any test persona in this suite)
    patientOtherClinicId = randomUUID();
    await withTenantContext(otherClinicId, () =>
      dbAdmin('patients').insert({
        id: patientOtherClinicId, clinic_id: otherClinicId,
        given_name: 'Other', family_name: 'Clinic',
        date_of_birth: '1985-06-12',
      }),
    );

    // Team relationships:
    //   clinicianOnTeamAId: staff_team_assignments on grandchild team (direct membership)
    //   teamLeaderRoleOnlyId: staff_role_assignments on grandchild team (role, no plain membership)
    //   executiveAtFacilityId: staff_role_assignments at facility (parent of teams)
    //   receptionistOnTeamAId: staff_team_assignments on grandchild (team attached but operational)
    //   clinicianOnTeamBId: staff_team_assignments on team B (NOT the patient's team)
    await withTenantContext(clinicId, async () => {
      await dbAdmin('staff_team_assignments').insert([
        {
          id: randomUUID(), clinic_id: clinicId, staff_id: clinicianOnTeamAId,
          org_unit_id: grandchildTeamOrgUnitId,
          start_date: '2024-01-01', is_active: true,
        },
        {
          id: randomUUID(), clinic_id: clinicId, staff_id: receptionistOnTeamAId,
          org_unit_id: grandchildTeamOrgUnitId,
          start_date: '2024-01-01', is_active: true,
        },
        {
          id: randomUUID(), clinic_id: clinicId, staff_id: clinicianOnTeamBId,
          org_unit_id: teamBOrgUnitId,
          start_date: '2024-01-01', is_active: true,
        },
      ]);
      await dbAdmin('staff_role_assignments').insert([
        {
          id: randomUUID(), clinic_id: clinicId, staff_id: teamLeaderRoleOnlyId,
          org_unit_id: grandchildTeamOrgUnitId,
          clinical_role_id: clinicalRoleId,
          role_type: 'team_leader',
          start_date: '2024-01-01', is_active: true,
        },
        {
          id: randomUUID(), clinic_id: clinicId, staff_id: executiveAtFacilityId,
          org_unit_id: facilityOrgUnitId,
          clinical_role_id: clinicalRoleId,
          role_type: 'manager',
          start_date: '2024-01-01', is_active: true,
        },
        {
          id: randomUUID(), clinic_id: clinicId, staff_id: clinicalDirectorId,
          org_unit_id: teamBOrgUnitId,
          clinical_role_id: clinicalDirectorRoleId,
          role_type: 'primary',
          start_date: '2024-01-01', is_active: true,
        },
        {
          id: randomUUID(), clinic_id: clinicId, staff_id: executiveDirectorId,
          org_unit_id: teamBOrgUnitId,
          clinical_role_id: executiveDirectorRoleId,
          role_type: 'primary',
          start_date: '2024-01-01', is_active: true,
        },
      ]);
    });

    // Nominated/delegated admin wiring for the test clinic
    await dbAdmin('clinics').where({ id: clinicId }).update({
      nominated_admin_staff_id: nominatedAdminId,
      delegated_admin_staff_id: delegatedAdminId,
    });
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    if (!clinicId) return;
    await dbAdmin('clinics').where({ id: clinicId }).update({
      nominated_admin_staff_id: null,
      delegated_admin_staff_id: null,
    });
    await withTenantContext(clinicId, async () => {
      await dbAdmin('staff_role_assignments').whereIn('staff_id', [
        teamLeaderRoleOnlyId,
        executiveAtFacilityId,
        clinicalDirectorId,
        executiveDirectorId,
      ]).delete();
      await dbAdmin('staff_team_assignments').whereIn('staff_id', [
        clinicianOnTeamAId, receptionistOnTeamAId, clinicianOnTeamBId,
      ]).delete();
      if (patientId) await dbAdmin('patient_team_assignments').where({ patient_id: patientId }).delete();
      if (patientId) await dbAdmin('patients').where({ id: patientId }).delete();
      await dbAdmin('staff').whereIn('id', [
        clinicianOnTeamAId, teamLeaderRoleOnlyId, executiveAtFacilityId,
        clinicalDirectorId, executiveDirectorId,
        receptionistOnTeamAId, clinicianOnTeamBId,
        nominatedAdminId, delegatedAdminId, genericAdminNotNominatedId,
        superadminId,
      ]).delete();
      await dbAdmin('clinical_roles').whereIn('id', [
        clinicalRoleId,
        clinicalDirectorRoleId,
        executiveDirectorRoleId,
      ]).delete();
      await dbAdmin('org_units').whereIn('id', [
        grandchildTeamOrgUnitId, teamAOrgUnitId, teamBOrgUnitId, facilityOrgUnitId,
      ]).delete();
    });
    if (patientOtherClinicId) {
      await withTenantContext(otherClinicId, () =>
        dbAdmin('patients').where({ id: patientOtherClinicId }).delete(),
      );
    }
    if (otherClinicId) await dbAdmin('clinics').where({ id: otherClinicId }).delete();
  });

  // ── Clinical rail ──────────────────────────────────────────────

  it('T1 — clinician with staff_team_assignments on patient team → passes', async () => {
    const auth = buildAuth({ staffId: clinicianOnTeamAId, clinicId, role: 'clinician' });
    await expect(inTenant(clinicId, () => requirePatientRelationship(auth, patientId))).resolves.not.toThrow();
  });

  it('T2 — team-leader with staff_role_assignments only (no staff_team_assignments) → passes', async () => {
    const auth = buildAuth({ staffId: teamLeaderRoleOnlyId, clinicId, role: 'clinician' });
    await expect(inTenant(clinicId, () => requirePatientRelationship(auth, patientId))).resolves.not.toThrow();
  });

  it('T3 — executive with staff_role_assignments at facility (ancestor of team) → passes (hierarchy cascade)', async () => {
    const auth = buildAuth({ staffId: executiveAtFacilityId, clinicId, role: 'clinician' });
    await expect(inTenant(clinicId, () => requirePatientRelationship(auth, patientId))).resolves.not.toThrow();
  });

  it('T4 — superadmin accessing clinical data → 403 NO_PATIENT_RELATIONSHIP (no role bypass)', async () => {
    const auth = buildAuth({ staffId: superadminId, clinicId, role: 'superadmin' });
    await expect(inTenant(clinicId, () => requirePatientRelationship(auth, patientId)))
      .rejects.toMatchObject({ status: 403, code: 'NO_PATIENT_RELATIONSHIP' });
  });

  it('T5 — generic role=admin (NOT nominated/delegated) → 403 (no role bypass)', async () => {
    const auth = buildAuth({ staffId: genericAdminNotNominatedId, clinicId, role: 'admin' });
    await expect(inTenant(clinicId, () => requirePatientRelationship(auth, patientId)))
      .rejects.toMatchObject({ status: 403, code: 'NO_PATIENT_RELATIONSHIP' });
  });

  it('T6 — nominated_admin_staff_id → passes (clinic-scoped bypass)', async () => {
    const auth = buildAuth({ staffId: nominatedAdminId, clinicId, role: 'admin' });
    await expect(inTenant(clinicId, () => requirePatientRelationship(auth, patientId))).resolves.not.toThrow();
  });

  it('T7 — delegated_admin_staff_id → passes (clinic-scoped bypass)', async () => {
    const auth = buildAuth({ staffId: delegatedAdminId, clinicId, role: 'admin' });
    await expect(inTenant(clinicId, () => requirePatientRelationship(auth, patientId))).resolves.not.toThrow();
  });

  it('T8 — receptionist with staff_team_assignments → requireClinicalAccessRole blocks at 403', () => {
    const auth = buildAuth({ staffId: receptionistOnTeamAId, clinicId, role: 'receptionist' });
    try {
      requireClinicalAccessRole(auth);
      throw new Error('Expected requireClinicalAccessRole to throw');
    } catch (err: unknown) {
      const e = err as { status?: number; code?: string };
      expect(e.status).toBe(403);
      expect(e.code).toBe('CLINICAL_ACCESS_DENIED');
    }
  });

  it('T9 — clinician on team B accessing patient in team A → 403 (unchanged)', async () => {
    const auth = buildAuth({ staffId: clinicianOnTeamBId, clinicId, role: 'clinician' });
    await expect(inTenant(clinicId, () => requirePatientRelationship(auth, patientId)))
      .rejects.toMatchObject({ status: 403, code: 'NO_PATIENT_RELATIONSHIP' });
  });

  // ── Settings rail ──────────────────────────────────────────────

  it('T10 — nominated admin passes requireAccessSettingsAuthority for their clinic', async () => {
    const auth = buildAuth({ staffId: nominatedAdminId, clinicId, role: 'admin' });
    await expect(inTenant(clinicId, () => requireAccessSettingsAuthority(auth, clinicId))).resolves.not.toThrow();
  });

  it('T11 — delegated admin passes requireAccessSettingsAuthority for their clinic', async () => {
    const auth = buildAuth({ staffId: delegatedAdminId, clinicId, role: 'admin' });
    await expect(inTenant(clinicId, () => requireAccessSettingsAuthority(auth, clinicId))).resolves.not.toThrow();
  });

  it('T12 — generic role=admin (NOT nominated) → 403 ACCESS_SETTINGS_READ_ONLY', async () => {
    const auth = buildAuth({ staffId: genericAdminNotNominatedId, clinicId, role: 'admin' });
    await expect(inTenant(clinicId, () => requireAccessSettingsAuthority(auth, clinicId)))
      .rejects.toMatchObject({ status: 403, code: 'ACCESS_SETTINGS_READ_ONLY' });
  });

  it('T13 — generic admin can still view (requireClinicalAccessRole does not reject admins)', () => {
    // T13 pins the view-only side: requireClinicalAccessRole passes for
    // role='admin' (only operational roles are blocked). The HTTP layer
    // still gates GET on requireRole('admin','superadmin') — view access
    // is preserved; only writes flip to requireAccessSettingsAuthority.
    const auth = buildAuth({ staffId: genericAdminNotNominatedId, clinicId, role: 'admin' });
    expect(() => requireClinicalAccessRole(auth)).not.toThrow();
  });

  it('T14 — superadmin passes requireAccessSettingsAuthority for any clinic (cross-clinic operator)', async () => {
    const auth = buildAuth({ staffId: superadminId, clinicId, role: 'superadmin' });
    // Superadmin short-circuits at the role check; no DB read needed.
    // Test without a tenant context to confirm the superadmin path
    // doesn't depend on RLS state (it returns before any query).
    await expect(requireAccessSettingsAuthority(auth, clinicId)).resolves.not.toThrow();
    await expect(requireAccessSettingsAuthority(auth, otherClinicId)).resolves.not.toThrow();
  });

  // ── BUG-351 absorb: post-facto role-demotion / deactivation ────
  // Without the staff JOIN + role/is_active enforcement at Check 0, a
  // demoted or deactivated staff member still holds clinic-wide PHI
  // bypass via `clinics.nominated_admin_staff_id`. These tests pin
  // the Layer-A defence against that drift.

  it('T15 — BUG-351: nominated admin demoted to receptionist loses bypass', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    // nominatedAdminId is currently `role='admin'` + nominated on this
    // clinic (from beforeAll). Demote to operational-only.
    await dbAdmin('staff').where({ id: nominatedAdminId }).update({ role: 'receptionist' });
    try {
      const auth = buildAuth({ staffId: nominatedAdminId, clinicId, role: 'admin' });
      // Even with the stale JWT role='admin', Check 0 must RE-VERIFY
      // the staff's CURRENT role in the DB and refuse the bypass.
      await expect(inTenant(clinicId, () => requirePatientRelationship(auth, patientId)))
        .rejects.toMatchObject({ status: 403, code: 'NO_PATIENT_RELATIONSHIP' });
    } finally {
      // Restore for subsequent tests
      await dbAdmin('staff').where({ id: nominatedAdminId }).update({ role: 'admin' });
    }
  });

  it('T16 — BUG-351: delegated admin deactivated loses bypass', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('staff').where({ id: delegatedAdminId }).update({ is_active: false });
    try {
      const auth = buildAuth({ staffId: delegatedAdminId, clinicId, role: 'admin' });
      await expect(inTenant(clinicId, () => requirePatientRelationship(auth, patientId)))
        .rejects.toMatchObject({ status: 403, code: 'NO_PATIENT_RELATIONSHIP' });
    } finally {
      await dbAdmin('staff').where({ id: delegatedAdminId }).update({ is_active: true });
    }
  });

  it('T17 — BUG-351 L3-absorb: nominated admin soft-deleted loses bypass', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    // Soft-delete the nominated admin per staffRepository SSoT: set
    // deleted_at to now, but leave is_active true (the two are
    // orthogonal offboarding signals in this codebase).
    await dbAdmin('staff').where({ id: nominatedAdminId }).update({ deleted_at: new Date() });
    try {
      const auth = buildAuth({ staffId: nominatedAdminId, clinicId, role: 'admin' });
      await expect(inTenant(clinicId, () => requirePatientRelationship(auth, patientId)))
        .rejects.toMatchObject({ status: 403, code: 'NO_PATIENT_RELATIONSHIP' });
    } finally {
      await dbAdmin('staff').where({ id: nominatedAdminId }).update({ deleted_at: null });
    }
  });

  it('T18 — Clinical Director role gets clinic-wide patient access across unrelated teams', async () => {
    const auth = buildAuth({ staffId: clinicalDirectorId, clinicId, role: 'clinician' });
    await expect(inTenant(clinicId, () => requirePatientRelationship(auth, patientId))).resolves.not.toThrow();
  });

  it('T19 — Executive Director role gets clinic-wide patient access across unrelated teams', async () => {
    const auth = buildAuth({ staffId: executiveDirectorId, clinicId, role: 'clinician' });
    await expect(inTenant(clinicId, () => requirePatientRelationship(auth, patientId))).resolves.not.toThrow();
  });
});

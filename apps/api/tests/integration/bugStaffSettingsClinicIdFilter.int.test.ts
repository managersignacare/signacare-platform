/**
 * BUG-STAFF-SETTINGS-CLINIC-ID-FILTER (S1) — cross-tenant write
 * authorization rejection.
 *
 * Pre-fix state: 12 UPDATE/DELETE surfaces in staffSettingsRepository.ts
 * used `db('<table>').where({ id }).update(...)` / `.delete()` with NO
 * tenant filter. Group 1 (4 tables WITH clinic_id + RLS — 8 sites)
 * relied on RLS belt; Group 2 (2 tables WITHOUT clinic_id + NO RLS — 4
 * sites) had NO mitigation at all.
 *
 * Post-fix state (operator-authorized 2026-05-06 option c): Group 2
 * tables (staff_team_assignments + staff_role_assignments) now carry
 * `clinic_id NOT NULL` + FK + RLS policy per migration 20260701000054;
 * all 12 app-layer surfaces add `.where({ id, clinic_id: clinicId })`
 * filter.
 *
 * This suite exercises the full HTTP stack (authMiddleware →
 * rlsMiddleware → controller → service → repository) for each of the
 * 6 resources × 2 attack vectors (PUT + DELETE) = 12 test cases. For
 * each:
 *   1. Seed a row in OTHER clinic via dbAdmin (bypasses RLS).
 *   2. Authenticate as same-clinic admin.
 *   3. Attempt PUT against the OTHER clinic's row id.
 *   4. Assert: 404 Not Found (post-fix WHERE clause filters by clinic_id).
 *   5. Read row directly via dbAdmin to confirm UNCHANGED.
 *   6. Attempt DELETE against the OTHER clinic's row id.
 *   7. Assert: 200 OK (idempotent — endpoint always returns ok:true)
 *      AND row STILL EXISTS via dbAdmin (post-fix WHERE clause prevents
 *      cross-tenant deletion).
 *
 * Pre-fix RED gate: this suite would have observed PUT 200 + row mutated
 * AND DELETE 200 + row removed — the BUG-confirmed state. Post-fix:
 * PUT 404 + row untouched + DELETE 200 + row STILL EXISTS.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../src/server';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-STAFF-SETTINGS-CLINIC-ID-FILTER cross-tenant rejection', () => {
  let token: string;
  let otherClinicId: string;
  let otherStaffId: string;
  let otherOrgUnitId: string;
  let otherClinicalRoleId: string;

  // Other-clinic row IDs (seeded via dbAdmin, target of cross-tenant attempts)
  let otherDisciplineId: string;
  let otherClinicalRoleAsLookupId: string;
  let otherTeamAssignmentId: string;
  let otherRoleAssignmentId: string;
  let otherReferralSourceId: string;
  let otherInvestigationTypeId: string;

  beforeAll(async () => {
    const s = await loginAsAdmin();
    token = s.token;

    const { dbAdmin } = await import('../../src/db/db');

    // Create OTHER clinic (no nominated admin; tests don't auth against it)
    const [other] = (await dbAdmin('clinics')
      .insert({
        id: randomUUID(),
        name: `bug-staff-clinic-id-other-${Date.now()}`,
        is_active: true,
        hpio: `800362${String(Date.now()).slice(-10)}`,
      })
      .returning(['id'])) as Array<{ id: string }>;
    otherClinicId = other.id;

    // Seed dependencies + cross-tenant rows inside explicit OTHER clinic
    // tenant context to satisfy FORCE RLS policy.
    await withTenantContext(otherClinicId, async () => {
      const [otherStaff] = (await dbAdmin('staff')
        .insert({
          id: randomUUID(),
          clinic_id: otherClinicId,
          email: `bug-staff-other-${Date.now()}@example.invalid`,
          password_hash: 'x', // unused; we never log in as this user
          given_name: 'Other',
          family_name: 'Admin',
          role: 'admin',
        })
        .returning(['id'])) as Array<{ id: string }>;
      otherStaffId = otherStaff.id;

      const [otherOrg] = (await dbAdmin('org_units')
        .insert({ id: randomUUID(), clinic_id: otherClinicId, name: `Other-Unit-${Date.now()}`, level: 'team' })
        .returning(['id'])) as Array<{ id: string }>;
      otherOrgUnitId = otherOrg.id;

      const [d] = (await dbAdmin('professional_disciplines')
        .insert({ id: randomUUID(), clinic_id: otherClinicId, name: `Other-Discipline-${Date.now()}`, is_active: true, sort_order: 0 })
        .returning(['id'])) as Array<{ id: string }>;
      otherDisciplineId = d.id;

      const [cr] = (await dbAdmin('clinical_roles')
        .insert({ id: randomUUID(), clinic_id: otherClinicId, name: `Other-Role-${Date.now()}`, is_active: true, sort_order: 0 })
        .returning(['id'])) as Array<{ id: string }>;
      otherClinicalRoleId = cr.id;
      otherClinicalRoleAsLookupId = cr.id;

      const [ta] = (await dbAdmin('staff_team_assignments')
        .insert({
          id: randomUUID(),
          clinic_id: otherClinicId,
          staff_id: otherStaffId,
          org_unit_id: otherOrgUnitId,
          start_date: '2026-01-01',
          is_active: true,
        })
        .returning(['id'])) as Array<{ id: string }>;
      otherTeamAssignmentId = ta.id;

      const [ra] = (await dbAdmin('staff_role_assignments')
        .insert({
          id: randomUUID(),
          clinic_id: otherClinicId,
          staff_id: otherStaffId,
          org_unit_id: otherOrgUnitId,
          clinical_role_id: otherClinicalRoleId,
          role_type: 'primary',
          start_date: '2026-01-01',
          is_active: true,
        })
        .returning(['id'])) as Array<{ id: string }>;
      otherRoleAssignmentId = ra.id;

      const [rs] = (await dbAdmin('referral_sources')
        .insert({ id: randomUUID(), clinic_id: otherClinicId, category: 'internal', name: `Other-Src-${Date.now()}`, is_active: true, sort_order: 0 })
        .returning(['id'])) as Array<{ id: string }>;
      otherReferralSourceId = rs.id;

      const [it] = (await dbAdmin('investigation_types')
        .insert({ id: randomUUID(), clinic_id: otherClinicId, name: `Other-Inv-${Date.now()}`, is_active: true, sort_order: 0 })
        .returning(['id'])) as Array<{ id: string }>;
      otherInvestigationTypeId = it.id;
    });
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    // Best-effort cleanup; rely on dbAdmin to bypass RLS
    if (otherClinicId) {
      await withTenantContext(otherClinicId, async () => {
        if (otherInvestigationTypeId) await dbAdmin('investigation_types').where({ id: otherInvestigationTypeId }).delete().catch(() => {});
        if (otherReferralSourceId) await dbAdmin('referral_sources').where({ id: otherReferralSourceId }).delete().catch(() => {});
        if (otherRoleAssignmentId) await dbAdmin('staff_role_assignments').where({ id: otherRoleAssignmentId }).delete().catch(() => {});
        if (otherTeamAssignmentId) await dbAdmin('staff_team_assignments').where({ id: otherTeamAssignmentId }).delete().catch(() => {});
        if (otherClinicalRoleId) await dbAdmin('clinical_roles').where({ id: otherClinicalRoleId }).delete().catch(() => {});
        if (otherDisciplineId) await dbAdmin('professional_disciplines').where({ id: otherDisciplineId }).delete().catch(() => {});
        if (otherOrgUnitId) await dbAdmin('org_units').where({ id: otherOrgUnitId }).delete().catch(() => {});
        if (otherStaffId) await dbAdmin('staff').where({ id: otherStaffId }).delete().catch(() => {});
      }).catch(() => {});
    }
    if (otherClinicId) await dbAdmin('clinics').where({ id: otherClinicId }).delete().catch(() => {});
  });

  // Helper: assert PUT against cross-tenant row returns 404 AND row exists
  // (caller does its own field-level assertion that the value didn't change).
  async function assertPutRejected(path: string, body: object, table: string, rowId: string) {
    const res = await request(app)
      .patch(path)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send(body);
    expect(res.status).toBe(404);

    const { dbAdmin } = await import('../../src/db/db');
    const row = await withTenantContext(otherClinicId, async () =>
      dbAdmin(table).where({ id: rowId }).first(),
    );
    expect(row).toBeTruthy();
  }

  // Helper: assert DELETE against cross-tenant row returns 200 (idempotent)
  // BUT row STILL EXISTS in other clinic.
  async function assertDeleteRejected(path: string, table: string, rowId: string) {
    const res = await request(app)
      .delete(path)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const { dbAdmin } = await import('../../src/db/db');
    const row = await withTenantContext(otherClinicId, async () =>
      dbAdmin(table).where({ id: rowId }).first(),
    );
    expect(row).toBeTruthy(); // Row still exists in other clinic — cross-tenant delete prevented.
  }

  test('PUT /disciplines/:id cross-tenant → 404 + row unchanged', async () => {
    await assertPutRejected(
      `/api/v1/staff-settings/disciplines/${otherDisciplineId}`,
      { name: 'Hijacked' },
      'professional_disciplines',
      otherDisciplineId,
    );
    const { dbAdmin } = await import('../../src/db/db');
    const row = await withTenantContext(otherClinicId, async () =>
      dbAdmin('professional_disciplines').where({ id: otherDisciplineId }).first(),
    );
    expect((row as { name: string }).name).not.toBe('Hijacked');
  });

  test('DELETE /disciplines/:id cross-tenant → 200 + row still exists', async () => {
    await assertDeleteRejected(
      `/api/v1/staff-settings/disciplines/${otherDisciplineId}`,
      'professional_disciplines',
      otherDisciplineId,
    );
  });

  test('PUT /clinical-roles/:id cross-tenant → 404 + row unchanged', async () => {
    const res = await request(app)
      .patch(`/api/v1/staff-settings/clinical-roles/${otherClinicalRoleAsLookupId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({ name: 'Hijacked' });
    expect(res.status).toBe(404);
    const { dbAdmin } = await import('../../src/db/db');
    const row = await withTenantContext(otherClinicId, async () =>
      dbAdmin('clinical_roles').where({ id: otherClinicalRoleAsLookupId }).first(),
    );
    expect((row as { name: string }).name).not.toBe('Hijacked');
  });

  test('DELETE /clinical-roles/:id cross-tenant → 200 + row still exists', async () => {
    // Seed a SEPARATE clinical_role row in the OTHER clinic, distinct from
    // otherClinicalRoleId which is used by the staff_role_assignments
    // FK chain (we cannot DELETE that one without breaking the FK chain).
    const { dbAdmin } = await import('../../src/db/db');
    const [extra] = (await withTenantContext(otherClinicId, async () =>
      dbAdmin('clinical_roles')
        .insert({ id: randomUUID(), clinic_id: otherClinicId, name: `Other-Role-Deletable-${Date.now()}`, is_active: true, sort_order: 99 })
        .returning(['id']),
    )) as Array<{ id: string }>;
    try {
      await assertDeleteRejected(
        `/api/v1/staff-settings/clinical-roles/${extra.id}`,
        'clinical_roles',
        extra.id,
      );
    } finally {
      await withTenantContext(otherClinicId, async () =>
        dbAdmin('clinical_roles').where({ id: extra.id }).delete(),
      ).catch(() => {});
    }
  });

  test('PUT /team-assignments/:id cross-tenant → 404 + row unchanged', async () => {
    const res = await request(app)
      .patch(`/api/v1/staff-settings/team-assignments/${otherTeamAssignmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({ is_active: false });
    expect(res.status).toBe(404);
    const { dbAdmin } = await import('../../src/db/db');
    const row = await withTenantContext(otherClinicId, async () =>
      dbAdmin('staff_team_assignments').where({ id: otherTeamAssignmentId }).first(),
    );
    expect((row as { is_active: boolean }).is_active).toBe(true);
  });

  test('DELETE /team-assignments/:id cross-tenant → 200 + row still exists', async () => {
    await assertDeleteRejected(
      `/api/v1/staff-settings/team-assignments/${otherTeamAssignmentId}`,
      'staff_team_assignments',
      otherTeamAssignmentId,
    );
  });

  test('PUT /role-assignments/:id cross-tenant → 404 + row unchanged', async () => {
    const res = await request(app)
      .patch(`/api/v1/staff-settings/role-assignments/${otherRoleAssignmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({ is_active: false });
    expect(res.status).toBe(404);
    const { dbAdmin } = await import('../../src/db/db');
    const row = await withTenantContext(otherClinicId, async () =>
      dbAdmin('staff_role_assignments').where({ id: otherRoleAssignmentId }).first(),
    );
    expect((row as { is_active: boolean }).is_active).toBe(true);
  });

  test('DELETE /role-assignments/:id cross-tenant → 200 + row still exists', async () => {
    await assertDeleteRejected(
      `/api/v1/staff-settings/role-assignments/${otherRoleAssignmentId}`,
      'staff_role_assignments',
      otherRoleAssignmentId,
    );
  });

  test('PUT /referral-sources/:id cross-tenant → 404 + row unchanged', async () => {
    const res = await request(app)
      .patch(`/api/v1/staff-settings/referral-sources/${otherReferralSourceId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({ name: 'Hijacked' });
    expect(res.status).toBe(404);
    const { dbAdmin } = await import('../../src/db/db');
    const row = await withTenantContext(otherClinicId, async () =>
      dbAdmin('referral_sources').where({ id: otherReferralSourceId }).first(),
    );
    expect((row as { name: string }).name).not.toBe('Hijacked');
  });

  test('DELETE /referral-sources/:id cross-tenant → 200 + row still exists', async () => {
    await assertDeleteRejected(
      `/api/v1/staff-settings/referral-sources/${otherReferralSourceId}`,
      'referral_sources',
      otherReferralSourceId,
    );
  });

  test('PUT /investigation-types/:id cross-tenant → 404 + row unchanged', async () => {
    const res = await request(app)
      .patch(`/api/v1/staff-settings/investigation-types/${otherInvestigationTypeId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({ name: 'Hijacked' });
    expect(res.status).toBe(404);
    const { dbAdmin } = await import('../../src/db/db');
    const row = await withTenantContext(otherClinicId, async () =>
      dbAdmin('investigation_types').where({ id: otherInvestigationTypeId }).first(),
    );
    expect((row as { name: string }).name).not.toBe('Hijacked');
  });

  test('DELETE /investigation-types/:id cross-tenant → 200 + row still exists', async () => {
    await assertDeleteRejected(
      `/api/v1/staff-settings/investigation-types/${otherInvestigationTypeId}`,
      'investigation_types',
      otherInvestigationTypeId,
    );
  });
});

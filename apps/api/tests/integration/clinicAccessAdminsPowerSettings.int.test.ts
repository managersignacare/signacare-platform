/**
 * Phase 0.5.C — Power Settings UI backend for access-administrators.
 *
 * Two new endpoints on powerSettingsRoutes:
 *
 *   GET  /api/v1/power-settings/clinics/:clinicId/access-admins
 *     — any `admin` or `superadmin` may view. Returns {
 *         nominatedAdmin: { id, givenName, familyName, role } | null,
 *         delegatedAdmin: { id, givenName, familyName, role } | null,
 *       }
 *
 *   PUT  /api/v1/power-settings/clinics/:clinicId/access-admins
 *     — superadmin ONLY. Body: { nominatedAdminStaffId, delegatedAdminStaffId }
 *       (either may be null). Validates: both distinct, both staff of
 *       that clinic (enforced by DB trigger from 0.5.A), neither is
 *       operational-only. Writes audit row.
 *
 * Coverage (5 tests):
 *   P1 — superadmin GET → 200 with current state + actor identity
 *   P2 — superadmin PUT valid pair → 200 + audit_log row written
 *   P3 — superadmin PUT same staff in both slots → 400 VALIDATION_ERROR
 *   P4 — superadmin PUT operational-only staff → 400 VALIDATION_ERROR
 *   P5 — non-superadmin PUT → 403 FORBIDDEN
 *
 * Negative-view case: a non-superadmin admin CAN GET (view) but not PUT
 * (change). That's covered by the adjacent suite clinicalAccessRbac
 * (T12 settings-rail 403) + the existing staffSettingsRoutes integration.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../src/server';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { issueTokens } from '../../src/features/auth/authService';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('Phase 0.5.C Power Settings access-admins endpoints', () => {
  let superadminToken: string;
  let adminToken: string;
  let clinicId: string;
  let staffAId: string;
  let staffBId: string;
  let operationalStaffId: string;
  let nonSuperadminAdminId: string;

  async function mintToken(opts: { staffId: string; clinicId: string; role: string }): Promise<string> {
    // Direct-mint avoids needing a valid bcrypt hash for seed staff.
    // Uses the same JWT signing path as /auth/login so the resulting
    // token is indistinguishable from one issued via the login endpoint.
    // Also seeds the Redis idle-window key that sessionIdleMiddleware
    // checks on every authenticated request; otherwise the request
    // would be rejected with 401 SESSION_IDLE_TIMEOUT before reaching
    // the settings-rail gate we're trying to exercise.
    const { dbAdmin } = await import('../../src/db/db');
    const staff = await dbAdmin('staff')
      .where({ id: opts.staffId, clinic_id: opts.clinicId })
      .first('email', 'given_name', 'family_name');
    if (!staff) {
      throw new Error(`Unable to mint token: staff ${opts.staffId} not found in clinic ${opts.clinicId}`);
    }
    const { accessToken } = issueTokens({
      id: opts.staffId,
      clinicId: opts.clinicId,
      role: opts.role as Parameters<typeof issueTokens>[0]['role'],
      permissions: [],
      email: String(staff.email),
      givenName: String(staff.given_name),
      familyName: String(staff.family_name),
    } as Parameters<typeof issueTokens>[0]);
    const { redis } = await import('../../src/config/redis');
    await redis.set(`idle:${opts.staffId}`, '1', 'EX', 60 * 60);
    return accessToken;
  }

  beforeAll(async () => {
    const session = await loginAsAdmin();
    superadminToken = session.token;
    clinicId = session.clinicId;

    const { dbAdmin } = await import('../../src/db/db');

    // Ensure seeded admin user is a superadmin in role-terms.
    // loginAsAdmin uses the seeded superadmin account per _helpers.ts.
    // Confirm:
    const seededSelf = await dbAdmin('staff').where({ id: session.userId }).first();
    if (seededSelf.role !== 'superadmin') {
      // flip to superadmin for this test run (seed data varies)
      await dbAdmin('staff').where({ id: session.userId }).update({ role: 'superadmin' });
    }

    // Seed two distinct candidate staff in this clinic
    staffAId = randomUUID();
    staffBId = randomUUID();
    operationalStaffId = randomUUID();
    nonSuperadminAdminId = randomUUID();
    await dbAdmin('staff').insert([
      {
        id: staffAId, clinic_id: clinicId,
        email: `p05c-a-${staffAId.slice(0, 6)}@signacare.local`,
        password_hash: 'stub', given_name: 'PwrA', family_name: 'Cand',
        role: 'admin', is_active: true,
      },
      {
        id: staffBId, clinic_id: clinicId,
        email: `p05c-b-${staffBId.slice(0, 6)}@signacare.local`,
        password_hash: 'stub', given_name: 'PwrB', family_name: 'Cand',
        role: 'admin', is_active: true,
      },
      {
        id: operationalStaffId, clinic_id: clinicId,
        email: `p05c-op-${operationalStaffId.slice(0, 6)}@signacare.local`,
        password_hash: 'stub', given_name: 'Recep', family_name: 'Op',
        role: 'receptionist', is_active: true,
      },
      {
        id: nonSuperadminAdminId, clinic_id: clinicId,
        email: `p05c-nsa-${nonSuperadminAdminId.slice(0, 6)}@signacare.local`,
        password_hash: 'stub',  // no login path; token is direct-minted
        given_name: 'NonSuper', family_name: 'Admin',
        role: 'admin', is_active: true,
      },
    ]);

    // Direct-mint a JWT for the non-superadmin admin (P5 scenario).
    // Same signing path as /auth/login; avoids needing a valid
    // bcrypt hash on the seed row.
    adminToken = await mintToken({
      staffId: nonSuperadminAdminId,
      clinicId,
      role: 'admin',
    });

    // Start with both slots clear for deterministic assertions.
    await dbAdmin('clinics').where({ id: clinicId }).update({
      nominated_admin_staff_id: null,
      delegated_admin_staff_id: null,
    });
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('clinics').where({ id: clinicId }).update({
      nominated_admin_staff_id: null,
      delegated_admin_staff_id: null,
    });
    // staff rows may already be referenced by immutable audit_log rows.
    // Soft-deactivate instead of DELETE so append-only FK chains remain valid.
    await dbAdmin('staff').whereIn('id', [
      staffAId, staffBId, operationalStaffId, nonSuperadminAdminId,
    ]).update({
      is_active: false,
      deleted_at: new Date(),
      updated_at: new Date(),
    });
  });

  function getAsSuper() {
    return request(app)
      .get(`/api/v1/power-settings/clinics/${clinicId}/access-admins`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile');
  }
  function putAsSuper(body: unknown) {
    return request(app)
      .put(`/api/v1/power-settings/clinics/${clinicId}/access-admins`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send(body);
  }
  function putAsAdmin(body: unknown) {
    return request(app)
      .put(`/api/v1/power-settings/clinics/${clinicId}/access-admins`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send(body);
  }

  it('P1 — superadmin GET returns current state + actor identities', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    // Preload known state
    await dbAdmin('clinics').where({ id: clinicId }).update({
      nominated_admin_staff_id: staffAId,
      delegated_admin_staff_id: staffBId,
    });

    const res = await getAsSuper();
    expect(res.status).toBe(200);
    // Endpoint may be returned as a direct object or wrapped in `{ data }`
    // depending on response-adapter convergence progress.
    const payload = (res.body && typeof res.body === 'object' && 'data' in res.body)
      ? (res.body as { data: unknown }).data
      : res.body;
    const shaped = payload as {
      nominatedAdmin?: { id: string; givenName: string } | null;
      delegatedAdmin?: { id: string; givenName: string } | null;
    };
    expect(shaped.nominatedAdmin).toBeDefined();
    expect(shaped.nominatedAdmin?.id).toBe(staffAId);
    expect(shaped.nominatedAdmin?.givenName).toBe('PwrA');
    expect(shaped.delegatedAdmin?.id).toBe(staffBId);
    expect(shaped.delegatedAdmin?.givenName).toBe('PwrB');

    // Reset
    await dbAdmin('clinics').where({ id: clinicId }).update({
      nominated_admin_staff_id: null,
      delegated_admin_staff_id: null,
    });
  });

  it('P2 — superadmin PUT assigns valid pair → 200 + audit row', async () => {
    const res = await putAsSuper({
      nominatedAdminStaffId: staffAId,
      delegatedAdminStaffId: staffBId,
    });
    expect(res.status).toBe(200);

    const { dbAdmin } = await import('../../src/db/db');
    const after = await dbAdmin('clinics').where({ id: clinicId }).first();
    expect(after.nominated_admin_staff_id).toBe(staffAId);
    expect(after.delegated_admin_staff_id).toBe(staffBId);

    // Audit row: table_name='clinics', operation='UPDATE', record_id=clinicId
    const auditRows = await dbAdmin('audit_log')
      .where({ table_name: 'clinics', record_id: clinicId, operation: 'UPDATE' })
      .orderBy('created_at', 'desc')
      .limit(5);
    const latest = auditRows[0];
    expect(latest).toBeDefined();
    const newData = typeof latest.new_data === 'string'
      ? JSON.parse(latest.new_data)
      : latest.new_data;
    expect(newData).toMatchObject({
      nominated_admin_staff_id: staffAId,
      delegated_admin_staff_id: staffBId,
    });
  });

  it('P3 — superadmin PUT same staff in both slots → 400 VALIDATION_ERROR', async () => {
    const res = await putAsSuper({
      nominatedAdminStaffId: staffAId,
      delegatedAdminStaffId: staffAId,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('P4 — superadmin PUT operational-only staff → 400 VALIDATION_ERROR', async () => {
    const res = await putAsSuper({
      nominatedAdminStaffId: operationalStaffId,
      delegatedAdminStaffId: null,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    // Error message should reference the operational-role rejection
    expect(String(res.body.error)).toMatch(/operational|receptionist|readonly/i);
  });

  it('P5 — non-superadmin PUT → 403 FORBIDDEN', async () => {
    const res = await putAsAdmin({
      nominatedAdminStaffId: staffAId,
      delegatedAdminStaffId: staffBId,
    });
    expect(res.status).toBe(403);
  });
});

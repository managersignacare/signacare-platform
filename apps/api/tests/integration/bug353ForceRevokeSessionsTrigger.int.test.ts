/**
 * BUG-353 Layer B integration — DB trigger
 * `force_revoke_sessions_on_staff_state_change` flips
 * `staff_sessions.revoked_at` to NOW() whenever a security-relevant
 * column on the staff row changes (role, is_active, deleted_at,
 * clinic_id).
 *
 * This is the DEFENCE-IN-DEPTH layer for BUG-356's Layer A wiring at
 * staffService.updateStaff. Layer A covers role + is_active via the
 * DTO. Layer B catches:
 *   - deleted_at transitions (no DTO field for soft-delete)
 *   - clinic_id transfers (no DTO field; maintenance-only)
 *   - direct SQL UPDATEs bypassing staffService entirely
 *
 * TDD: without the migration applied, T1-T3 FAIL because
 * `staff_sessions.revoked_at` stays NULL after the staff UPDATE.
 * Post-migration, T1-T3 PASS and audit row is written.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { dbAdmin } from '../../src/db/db';

const READY = await isIntegrationReady();

let clinicId = '';

beforeAll(async () => {
  if (!READY) return;
  const session = await loginAsAdmin();
  clinicId = session.clinicId;
});

async function seedActiveStaff(): Promise<{ staffId: string; sessionId: string }> {
  const staffId = randomUUID();
  const sessionId = randomUUID();
  await dbAdmin('staff').insert({
    id: staffId,
    clinic_id: clinicId,
    email: `bug353-${Date.now()}-${staffId.slice(0, 8)}@test.local`,
    given_name: 'Test',
    family_name: 'Subject',
    role: 'clinician',
    discipline: 'psychiatry',
    is_active: true,
    password_hash: 'x',
    updated_at: dbAdmin.fn.now(),
  });
  await dbAdmin('staff_sessions').insert({
    id: sessionId,
    staff_id: staffId,
    clinic_id: clinicId,
    refresh_token: `bug353-rt-${sessionId}`,
    expires_at: new Date(Date.now() + 7 * 86_400_000),
    revoked_at: null,
    updated_at: dbAdmin.fn.now(),
  });
  return { staffId, sessionId };
}

async function cleanup(staffId: string): Promise<void> {
  await dbAdmin('staff_sessions').where({ staff_id: staffId }).del();
  await dbAdmin('staff').where({ id: staffId }).del();
}

beforeEach(async () => {
  if (!READY) return;
});

afterAll(async () => {
  if (!READY) return;
  await dbAdmin('staff')
    .where('clinic_id', clinicId)
    .where('email', 'like', 'bug353-%')
    .del();
});

describe.skipIf(!READY)('BUG-353 Layer B — force_revoke_sessions_on_staff_state_change trigger', () => {
  it('T1: role change → active sessions get revoked_at=NOW() + audit row', async () => {
    const { staffId, sessionId } = await seedActiveStaff();
    await dbAdmin('staff')
      .where({ id: staffId })
      .update({ role: 'receptionist', updated_at: dbAdmin.fn.now() });

    const session = await dbAdmin('staff_sessions').where({ id: sessionId }).first();
    expect(session.revoked_at).not.toBeNull();

    const audit = await dbAdmin('audit_log')
      .where({
        clinic_id: clinicId,
        action: 'SESSION_REVOKED_BY_STATE_CHANGE_TRIGGER',
        record_id: staffId,
      })
      .first();
    expect(audit).toBeTruthy();
    expect(audit.new_data).toMatchObject({
      trigger: 'role_changed',
      sessions_revoked: 1,
      new_role: 'receptionist',
    });
    await cleanup(staffId);
  });

  it('T2: is_active=false → sessions revoked + audit', async () => {
    const { staffId, sessionId } = await seedActiveStaff();
    await dbAdmin('staff')
      .where({ id: staffId })
      .update({ is_active: false, updated_at: dbAdmin.fn.now() });

    const session = await dbAdmin('staff_sessions').where({ id: sessionId }).first();
    expect(session.revoked_at).not.toBeNull();
    const audit = await dbAdmin('audit_log')
      .where({ clinic_id: clinicId, action: 'SESSION_REVOKED_BY_STATE_CHANGE_TRIGGER', record_id: staffId })
      .first();
    expect(audit.new_data).toMatchObject({ trigger: 'active_changed', new_is_active: false });
    await cleanup(staffId);
  });

  it('T3: deleted_at set → sessions revoked (Layer-B-only — Layer A does not cover soft-delete)', async () => {
    const { staffId, sessionId } = await seedActiveStaff();
    await dbAdmin('staff')
      .where({ id: staffId })
      .update({ deleted_at: dbAdmin.fn.now(), updated_at: dbAdmin.fn.now() });

    const session = await dbAdmin('staff_sessions').where({ id: sessionId }).first();
    expect(session.revoked_at).not.toBeNull();
    const audit = await dbAdmin('audit_log')
      .where({ clinic_id: clinicId, action: 'SESSION_REVOKED_BY_STATE_CHANGE_TRIGGER', record_id: staffId })
      .first();
    expect(audit.new_data).toMatchObject({ trigger: 'soft_deleted', soft_deleted: true });
    await cleanup(staffId);
  });

  it('T4: benign update (given_name only) → sessions NOT revoked, no audit row', async () => {
    const { staffId, sessionId } = await seedActiveStaff();
    await dbAdmin('staff')
      .where({ id: staffId })
      .update({ given_name: 'NewFirstName', updated_at: dbAdmin.fn.now() });

    const session = await dbAdmin('staff_sessions').where({ id: sessionId }).first();
    expect(session.revoked_at).toBeNull();

    const audit = await dbAdmin('audit_log')
      .where({ clinic_id: clinicId, action: 'SESSION_REVOKED_BY_STATE_CHANGE_TRIGGER', record_id: staffId })
      .first();
    expect(audit).toBeFalsy();
    await cleanup(staffId);
  });

  it('T5: updating role to the SAME value → no revocation (IS DISTINCT FROM semantics)', async () => {
    const { staffId, sessionId } = await seedActiveStaff();
    const before = await dbAdmin('staff').where({ id: staffId }).first('role');
    await dbAdmin('staff')
      .where({ id: staffId })
      .update({ role: before.role, updated_at: dbAdmin.fn.now() });

    const session = await dbAdmin('staff_sessions').where({ id: sessionId }).first();
    expect(session.revoked_at).toBeNull();
    await cleanup(staffId);
  });

  it('T6: already-revoked sessions are not touched (WHERE revoked_at IS NULL)', async () => {
    const { staffId, sessionId } = await seedActiveStaff();
    const preRevoked = new Date(Date.now() - 3600_000).toISOString();
    await dbAdmin('staff_sessions').where({ id: sessionId }).update({ revoked_at: preRevoked });

    await dbAdmin('staff')
      .where({ id: staffId })
      .update({ role: 'receptionist', updated_at: dbAdmin.fn.now() });

    const session = await dbAdmin('staff_sessions').where({ id: sessionId }).first();
    expect(session.revoked_at).toBeTruthy();
    const revokedMs = new Date(session.revoked_at).getTime();
    const preMs = new Date(preRevoked).getTime();
    expect(revokedMs).toBe(preMs);

    const audit = await dbAdmin('audit_log')
      .where({ clinic_id: clinicId, action: 'SESSION_REVOKED_BY_STATE_CHANGE_TRIGGER', record_id: staffId })
      .first();
    expect(audit).toBeTruthy();
    expect(audit.new_data).toMatchObject({ trigger: 'role_changed', sessions_revoked: 0 });
    await cleanup(staffId);
  });
});

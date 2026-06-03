/**
 * BUG-354 forward-fix — audit_log emission on access-admin slot trigger.
 *
 * Complements the existing accessAdminSlotIntegrityTrigger.int.test.ts
 * (which pins the slot-NULLing behaviour) by adding the audit-emission
 * invariants required by L4 BLOCK + L5 REJECT:
 *
 *   T1 demote to receptionist → audit_log row with
 *      action='ADMIN_SLOT_CLEARED_BY_TRIGGER', table_name='clinics',
 *      record_id=clinic.id, new_data JSONB contains {staff_id, reason,
 *      slot}, reason='role_demoted'
 *   T2 deactivate → audit row with reason='deactivated'
 *   T3 benign UPDATE (given_name) → NO new audit row with that action
 *
 * The slot-NULLing assertions are preserved in the companion file; this
 * file covers ONLY the new audit-emission invariants so a future
 * regression that removes the audit INSERT from the trigger body fails
 * distinctly from a regression that removes the slot UPDATE.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-354 forward-fix — trigger emits audit_log rows', () => {
  let clinicId: string;
  let staffId: string;

  beforeAll(async () => {
    await loginAsAdmin();
    const { dbAdmin } = await import('../../src/db/db');
    clinicId = '11111111-1111-1111-1111-111111111111';

    const [s] = await dbAdmin('staff').insert({
      clinic_id: clinicId,
      email: `bug354audit-${Date.now()}@test.local`,
      given_name: 'AuditTest',
      family_name: 'Staff',
      role: 'clinician',
      password_hash: 'x',
      is_active: true,
    }).returning(['id']) as Array<{ id: string }>;
    staffId = s.id;
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    // Clear any slot pointing at the test staff + delete the staff row.
    if (clinicId) {
      await dbAdmin('clinics').where({ id: clinicId }).update({
        nominated_admin_staff_id: null,
        delegated_admin_staff_id: null,
      }).catch((err) => { void err; });
    }
    if (staffId) {
      await dbAdmin('audit_log')
        .where({ action: 'ADMIN_SLOT_CLEARED_BY_TRIGGER', record_id: clinicId })
        .where('created_at', '>=', new Date(Date.now() - 60 * 60 * 1000))
        .delete()
        .catch((err) => { void err; });
      await dbAdmin('staff').where({ id: staffId }).delete().catch((err) => { void err; });
    }
  });

  /**
   * Reset helper — ensure staff is eligible + slot points at them +
   * no pre-existing ADMIN_SLOT_CLEARED_BY_TRIGGER audit row for this
   * (clinic, staff) pair so each test starts from a clean slate.
   */
  async function resetFixtures(slot: 'nominated_admin_staff_id' | 'delegated_admin_staff_id'): Promise<Date> {
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('staff').where({ id: staffId }).update({
      role: 'clinician', is_active: true, deleted_at: null, given_name: 'AuditTest',
    });
    await dbAdmin('clinics').where({ id: clinicId }).update({
      nominated_admin_staff_id: null,
      delegated_admin_staff_id: null,
    });
    await dbAdmin('clinics').where({ id: clinicId }).update({ [slot]: staffId });
    return new Date();
  }

  test('T1 demote to receptionist emits ADMIN_SLOT_CLEARED_BY_TRIGGER audit row with reason=role_demoted', async () => {
    const startTime = await resetFixtures('nominated_admin_staff_id');
    const { dbAdmin } = await import('../../src/db/db');

    await dbAdmin('staff').where({ id: staffId }).update({ role: 'receptionist' });

    const auditRows = await dbAdmin('audit_log')
      .where({
        action: 'ADMIN_SLOT_CLEARED_BY_TRIGGER',
        table_name: 'clinics',
        record_id: clinicId,
      })
      .where('created_at', '>=', startTime)
      .select('new_data');

    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    const newData = typeof auditRows[0].new_data === 'string'
      ? JSON.parse(auditRows[0].new_data as string)
      : auditRows[0].new_data;
    expect(newData).toMatchObject({
      staff_id: staffId,
      reason: 'role_demoted',
      slot: 'nominated',
    });
  });

  test('T2 deactivate emits audit row with reason=deactivated', async () => {
    const startTime = await resetFixtures('delegated_admin_staff_id');
    const { dbAdmin } = await import('../../src/db/db');

    await dbAdmin('staff').where({ id: staffId }).update({ is_active: false });

    const auditRows = await dbAdmin('audit_log')
      .where({
        action: 'ADMIN_SLOT_CLEARED_BY_TRIGGER',
        table_name: 'clinics',
        record_id: clinicId,
      })
      .where('created_at', '>=', startTime)
      .select('new_data');

    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    const newData = typeof auditRows[0].new_data === 'string'
      ? JSON.parse(auditRows[0].new_data as string)
      : auditRows[0].new_data;
    expect(newData).toMatchObject({
      staff_id: staffId,
      reason: 'deactivated',
      slot: 'delegated',
    });
  });

  test('T3 benign given_name update emits NO ADMIN_SLOT_CLEARED_BY_TRIGGER audit row', async () => {
    const startTime = await resetFixtures('nominated_admin_staff_id');
    const { dbAdmin } = await import('../../src/db/db');

    // given_name is NOT in the trigger's OF column list — the trigger
    // does NOT fire, so no audit row should be emitted.
    await dbAdmin('staff').where({ id: staffId }).update({ given_name: 'AuditTestRenamed' });

    const auditRows = await dbAdmin('audit_log')
      .where({
        action: 'ADMIN_SLOT_CLEARED_BY_TRIGGER',
        table_name: 'clinics',
        record_id: clinicId,
      })
      .where('created_at', '>=', startTime)
      .select('id');

    expect(auditRows.length).toBe(0);
  });
});

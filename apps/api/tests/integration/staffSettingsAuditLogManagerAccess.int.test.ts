/**
 * BUG-AUDIT-MANAGER-READ — manager role should be able to read clinic audit
 * entries, while non-manager/non-admin clinical roles remain denied.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'crypto';
import {
  authedAgent,
  isIntegrationReady,
  loginAsAdmin,
  loginAsClinician,
  loginAsManager,
} from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('staff-settings audit-log manager access', () => {
  let managerToken = '';
  let clinicianToken = '';

  beforeAll(async () => {
    const [adminSession, managerSession, clinicianSession] = await Promise.all([
      loginAsAdmin(),
      loginAsManager(),
      loginAsClinician(),
    ]);
    managerToken = managerSession.token;
    clinicianToken = clinicianSession.token;

    // Seed a deterministic same-clinic audit row so "empty audit list"
    // cannot mask an access-control regression during this test.
    const { dbAdmin } = await import('../../src/db/db');
    await withTenantContext(adminSession.clinicId, async () => {
      await dbAdmin('audit_log').insert({
        id: randomUUID(),
        clinic_id: adminSession.clinicId,
        staff_id: adminSession.userId,
        user_id: adminSession.userId,
        operation: 'READ',
        action: 'read',
        table_name: 'staff_settings',
        module: 'staff_settings',
        record_id: adminSession.userId,
        entity_id: adminSession.userId,
        details: { probe: 'manager-audit-read' },
        new_data: { probe: 'manager-audit-read' },
        ip_address: '127.0.0.1',
        dedupe_key: `manager-audit-read-${Date.now()}`,
        created_at: new Date().toISOString(),
      });
    }, adminSession.userId);
  });

  test('manager can read audit log entries', async () => {
    const res = await authedAgent(managerToken).get('/api/v1/staff-settings/audit-log?page=1&limit=10');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(Number(res.body.total)).toBeGreaterThan(0);
  });

  test('clinician remains forbidden', async () => {
    const res = await authedAgent(clinicianToken).get('/api/v1/staff-settings/audit-log?page=1&limit=10');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN' });
  });
});

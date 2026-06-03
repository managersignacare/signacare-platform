import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { authedAgent, isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

async function waitForStaffSettingValue(
  staffId: string,
  key: string,
  timeoutMs = 1500,
): Promise<unknown> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const row = await dbAdmin('staff_settings')
      .where({ staff_id: staffId, setting_key: key })
      .first('setting_value');
    if (row && typeof row === 'object' && 'setting_value' in row) {
      return (row as { setting_value: unknown }).setting_value;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return undefined;
}

describe.skipIf(!READY)('BUG-STAFF-PROFILE-TAB-VISIBILITY', () => {
  it('persists per-staff profile-tab visibility and surfaces it on /staff/:id + /staff/me', async () => {
    const adminSession = await loginAsAdmin();
    const adminAgent = authedAgent(adminSession.token);
    const email = `profile-tab-${Date.now()}@example.test`.toLowerCase();
    let staffId: string | null = null;

    try {
      const createRes = await adminAgent.post('/api/v1/staff').send({
        givenName: 'Profile',
        familyName: 'Toggle',
        email,
        role: 'clinician',
        settingsProfileTabVisible: true,
      });
      expect(createRes.status).toBe(201);
      staffId = createRes.body?.id ?? null;
      expect(staffId).toBeTruthy();
      expect(createRes.body?.settingsProfileTabVisible).toBe(true);
      expect(typeof createRes.body?.temporaryPassword).toBe('string');

      // RLS middleware commits after response finish; poll briefly so this
      // assertion is robust to commit timing in CI.
      const createdSetting = await waitForStaffSettingValue(
        staffId!,
        'settings_profile_tab_visible',
      );
      expect(createdSetting).toBe(true);

      const getRes = await adminAgent.get(`/api/v1/staff/${staffId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body?.settingsProfileTabVisible).toBe(true);

      const tempPassword = String(createRes.body?.temporaryPassword);
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({ email, password: tempPassword });
      expect(loginRes.status).toBe(200);
      const staffToken = loginRes.body?.accessToken as string | undefined;
      expect(typeof staffToken).toBe('string');

      const staffAgent = authedAgent(staffToken!);
      const meBeforeToggle = await staffAgent.get('/api/v1/staff/me');
      expect(meBeforeToggle.status).toBe(200);
      expect(meBeforeToggle.body?.settingsProfileTabVisible).toBe(true);

      const updateRes = await adminAgent
        .put(`/api/v1/staff/${staffId}`)
        .send({ settingsProfileTabVisible: false });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body?.settingsProfileTabVisible).toBe(false);

      const getAfter = await adminAgent.get(`/api/v1/staff/${staffId}`);
      expect(getAfter.status).toBe(200);
      expect(getAfter.body?.settingsProfileTabVisible).toBe(false);

      const meAfterToggle = await staffAgent.get('/api/v1/staff/me');
      expect(meAfterToggle.status).toBe(200);
      expect(meAfterToggle.body?.settingsProfileTabVisible).toBe(false);
    } finally {
      if (staffId) {
        await dbAdmin('staff')
          .where({ id: staffId })
          .update({
            deleted_at: new Date(),
            is_active: false,
            email: `deleted+${staffId}@example.test`,
            updated_at: new Date(),
          })
          .catch(() => undefined);
      } else {
        await dbAdmin('staff')
          .where({ email })
          .update({
            deleted_at: new Date(),
            is_active: false,
            updated_at: new Date(),
          })
          .catch(() => undefined);
      }
    }
  });
});

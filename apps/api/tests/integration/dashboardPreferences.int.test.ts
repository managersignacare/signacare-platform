import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { isIntegrationReady, loginAsClinician } from './_helpers';

const ready = await isIntegrationReady();
const SETTING_KEY = 'dashboard_preferences';

interface Session {
  token: string;
  clinicId: string;
  userId: string;
}

interface StaffSettingSnapshot {
  setting_value: unknown;
  created_at?: Date | string;
  updated_at?: Date | string;
}

describe.skipIf(!ready)('Dashboard preferences routes', () => {
  let session: Session;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  let originalRow: StaffSettingSnapshot | null = null;

  beforeAll(async () => {
    session = await loginAsClinician();
    ({ dbAdmin } = await import('../../src/db/db'));
    originalRow = await dbAdmin('staff_settings')
      .where({ staff_id: session.userId, setting_key: SETTING_KEY })
      .first('setting_value', 'created_at', 'updated_at') ?? null;
  });

  afterAll(async () => {
    if (!dbAdmin || !session) return;
    await dbAdmin('staff_settings')
      .where({ staff_id: session.userId, setting_key: SETTING_KEY })
      .del();

    if (originalRow) {
      await dbAdmin('staff_settings').insert({
        staff_id: session.userId,
        setting_key: SETTING_KEY,
        setting_value: originalRow.setting_value,
        created_at: originalRow.created_at ?? new Date(),
        updated_at: originalRow.updated_at ?? new Date(),
      });
    }
  });

  it('returns role-safe defaults and the dashboard catalog when no row exists', async () => {
    await dbAdmin('staff_settings')
      .where({ staff_id: session.userId, setting_key: SETTING_KEY })
      .del();

    const res = await request(app)
      .get('/api/v1/dashboard/preferences')
      .set('Authorization', `Bearer ${session.token}`);

    expect(res.status).toBe(200);
    expect(res.body.preferences.density).toBe('comfortable');
    expect(res.body.preferences.enabledViews).toContain('my_dashboard');
    expect(res.body.catalog.length).toBeGreaterThan(0);
    expect(res.body.catalog.some((card: { id: string }) => card.id === 'manager-service-signals')).toBe(true);
  });

  it('persists normalized dashboard preferences and preserves saved view config across partial updates', async () => {
    const putRes = await request(app)
      .put('/api/v1/dashboard/preferences')
      .set('Authorization', `Bearer ${session.token}`)
      .send({
        density: 'compact',
        defaultView: 'manager',
        enabledViews: ['manager'],
        viewPreferences: {
          manager: {
            layoutMode: 'operations_command',
            hiddenCardIds: ['staff', 'manager-service-signals', 'not-a-real-card'],
            cardOrder: ['staff', 'manager-service-signals', 'bogus'],
          },
        },
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.preferences.defaultView).toBe('manager');
    expect(putRes.body.preferences.enabledViews).toEqual(['manager']);
    expect(putRes.body.preferences.viewPreferences.manager.hiddenCardIds).toEqual(['staff']);
    expect(putRes.body.preferences.viewPreferences.manager.cardOrder).toEqual(['staff', 'manager-service-signals']);

    const patchRes = await request(app)
      .put('/api/v1/dashboard/preferences')
      .set('Authorization', `Bearer ${session.token}`)
      .send({
        density: 'comfortable',
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.preferences.density).toBe('comfortable');
    expect(patchRes.body.preferences.defaultView).toBe('manager');
    expect(patchRes.body.preferences.viewPreferences.manager.hiddenCardIds).toEqual(['staff']);

    const getRes = await request(app)
      .get('/api/v1/dashboard/preferences')
      .set('Authorization', `Bearer ${session.token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.preferences.defaultView).toBe('manager');
    expect(getRes.body.preferences.viewPreferences.manager.layoutMode).toBe('operations_command');
    expect(getRes.body.preferences.viewPreferences.manager.hiddenCardIds).toEqual(['staff']);
  });
});

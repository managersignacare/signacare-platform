import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const MODULE_KEY = 'pathways';

describe.skipIf(!READY)('BUG-PATHWAYS-MODULE-TOGGLE', () => {
  let session: Awaited<ReturnType<typeof loginAsAdmin>>;
  let originalModuleRow: { id: string; is_enabled: boolean } | null = null;

  async function withClinicContext<T>(
    clinicId: string,
    work: (trx: Awaited<ReturnType<typeof dbAdmin.transaction>>) => Promise<T>,
  ): Promise<T> {
    return dbAdmin.transaction(async (trx) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
      return work(trx);
    });
  }

  async function assertClinicModulesTablePresent(): Promise<void> {
    const hasTable = await dbAdmin.schema.hasTable('clinic_modules');
    expect(hasTable).toBe(true);
  }

  async function setModuleEnabled(enabled: boolean): Promise<void> {
    await withClinicContext(session.clinicId, async (trx) => {
      await trx('clinic_modules')
        .insert({
          id: randomUUID(),
          clinic_id: session.clinicId,
          module_key: MODULE_KEY,
          is_enabled: enabled,
          updated_at: new Date(),
        })
        .onConflict(['clinic_id', 'module_key'])
        .merge({
          is_enabled: enabled,
          updated_at: new Date(),
        });
    });
  }

  beforeAll(async () => {
    session = await loginAsAdmin();
    await assertClinicModulesTablePresent();
    originalModuleRow = await withClinicContext(session.clinicId, async (trx) => (
      trx('clinic_modules')
        .where({ clinic_id: session.clinicId, module_key: MODULE_KEY })
        .first('id', 'is_enabled')
    ));
  });

  afterAll(async () => {
    if (!READY) return;
    await withClinicContext(session.clinicId, async (trx) => {
      if (!originalModuleRow) {
        await trx('clinic_modules')
          .where({ clinic_id: session.clinicId, module_key: MODULE_KEY })
          .del();
        return;
      }

      await trx('clinic_modules')
        .where({ id: originalModuleRow.id })
        .update({
          is_enabled: originalModuleRow.is_enabled,
          updated_at: new Date(),
        });
    });
  });

  it('returns MODULE_DISABLED when pathways module is disabled at clinic level', async () => {
    await setModuleEnabled(false);

    const res = await request(app)
      .get('/api/v1/pathways/patient/all')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');

    expect(res.status).toBe(403);
    expect(res.body?.code).toBe('MODULE_DISABLED');
  });

  it('allows pathway reads when pathways module is enabled', async () => {
    await setModuleEnabled(true);

    const res = await request(app)
      .get('/api/v1/pathways/patient/all')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

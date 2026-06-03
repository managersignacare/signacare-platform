import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsClinician } from './_helpers';

const READY = await isIntegrationReady();
const AGENTIC_MODULE_KEY = 'agentic-ai-scribe';
const MEDICAL_MODULE_KEY = 'medical-scribe';
const SCRIBE_FEATURE_FLAG = 'ai-scribe';

describe.skipIf(!READY)('BUG-AGENTIC-SCRIBE-MODULE-TOGGLE', () => {
  let session: Awaited<ReturnType<typeof loginAsClinician>>;
  let originalAgenticModuleRow: { id: string; is_enabled: boolean } | null = null;
  let originalMedicalModuleRow: { id: string; is_enabled: boolean } | null = null;
  let originalScribeFeatureFlag: { id: string; enabled: boolean } | null = null;

  async function withClinicContext<T>(
    clinicId: string,
    work: (trx: Awaited<ReturnType<typeof dbAdmin.transaction>>) => Promise<T>,
  ): Promise<T> {
    return dbAdmin.transaction(async (trx) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
      return work(trx);
    });
  }

  async function setModuleEnabled(moduleKey: string, enabled: boolean): Promise<void> {
    await withClinicContext(session.clinicId, async (trx) => {
      await trx('clinic_modules')
        .insert({
          id: randomUUID(),
          clinic_id: session.clinicId,
          module_key: moduleKey,
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

  async function deleteModuleRow(moduleKey: string): Promise<void> {
    await withClinicContext(session.clinicId, async (trx) => {
      await trx('clinic_modules')
        .where({ clinic_id: session.clinicId, module_key: moduleKey })
        .del();
    });
  }

  async function setScribeFeatureEnabled(enabled: boolean): Promise<void> {
    await withClinicContext(session.clinicId, async (trx) => {
      const existing = await trx('feature_flags')
        .where({ clinic_id: session.clinicId, name: SCRIBE_FEATURE_FLAG })
        .first('id');
      if (existing?.id) {
        await trx('feature_flags')
          .where({ id: existing.id })
          .update({
            enabled,
            rollout_percentage: 100,
            updated_at: new Date(),
          });
        return;
      }
      await trx('feature_flags')
        .insert({
          id: randomUUID(),
          clinic_id: session.clinicId,
          name: SCRIBE_FEATURE_FLAG,
          enabled,
          rollout_percentage: 100,
          created_at: new Date(),
          updated_at: new Date(),
        });
    });
  }

  beforeAll(async () => {
    session = await loginAsClinician();
    originalAgenticModuleRow = await withClinicContext(session.clinicId, async (trx) => (
      trx('clinic_modules')
        .where({ clinic_id: session.clinicId, module_key: AGENTIC_MODULE_KEY })
        .first('id', 'is_enabled')
    ));
    originalMedicalModuleRow = await withClinicContext(session.clinicId, async (trx) => (
      trx('clinic_modules')
        .where({ clinic_id: session.clinicId, module_key: MEDICAL_MODULE_KEY })
        .first('id', 'is_enabled')
    ));
    originalScribeFeatureFlag = await withClinicContext(session.clinicId, async (trx) => (
      trx('feature_flags')
        .where({ clinic_id: session.clinicId, name: SCRIBE_FEATURE_FLAG })
        .first('id', 'enabled')
    ));
    await setScribeFeatureEnabled(true);
  });

  afterAll(async () => {
    if (!READY) return;
    await withClinicContext(session.clinicId, async (trx) => {
      if (!originalAgenticModuleRow) {
        await trx('clinic_modules')
          .where({ clinic_id: session.clinicId, module_key: AGENTIC_MODULE_KEY })
          .del();
      } else {
        await trx('clinic_modules')
          .where({ id: originalAgenticModuleRow.id })
          .update({
            is_enabled: originalAgenticModuleRow.is_enabled,
            updated_at: new Date(),
          });
      }

      if (!originalMedicalModuleRow) {
        await trx('clinic_modules')
          .where({ clinic_id: session.clinicId, module_key: MEDICAL_MODULE_KEY })
          .del();
      } else {
        await trx('clinic_modules')
          .where({ id: originalMedicalModuleRow.id })
          .update({
            is_enabled: originalMedicalModuleRow.is_enabled,
            updated_at: new Date(),
          });
      }

      if (!originalScribeFeatureFlag) {
        await trx('feature_flags')
          .where({ clinic_id: session.clinicId, name: SCRIBE_FEATURE_FLAG })
          .del();
      } else {
        await trx('feature_flags')
          .where({ id: originalScribeFeatureFlag.id })
          .update({
            enabled: originalScribeFeatureFlag.enabled,
            updated_at: new Date(),
          });
      }
    });
  });

  it('returns MODULE_DISABLED when agentic-ai-scribe is disabled at clinic level', async () => {
    await setModuleEnabled(AGENTIC_MODULE_KEY, false);

    const res = await request(app)
      .post('/api/v1/agentic-scribe/drafts')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({ transcript: 'Follow-up in 2 weeks and order FBC with UEC. Refer to psychology.' });

    expect(res.status).toBe(403);
    expect(res.body?.code).toBe('MODULE_DISABLED');
  });

  it('fails closed when no clinic_modules row exists for agentic-ai-scribe', async () => {
    await deleteModuleRow(AGENTIC_MODULE_KEY);

    const res = await request(app)
      .post('/api/v1/agentic-scribe/drafts')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({ transcript: 'Follow-up in 2 weeks and order FBC with UEC. Refer to psychology.' });

    expect(res.status).toBe(403);
    expect(res.body?.code).toBe('MODULE_DISABLED');
  });

  it('returns structured draft bundles when module is enabled', async () => {
    await setModuleEnabled(AGENTIC_MODULE_KEY, true);

    const res = await request(app)
      .post('/api/v1/agentic-scribe/drafts')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        transcript: 'Please order FBC and UEC. Refer patient to psychology. Arrange follow-up in 2 weeks.',
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.drafts?.labOrders)).toBe(true);
    expect(Array.isArray(res.body?.drafts?.referrals)).toBe(true);
    expect(Array.isArray(res.body?.drafts?.followUps)).toBe(true);
  });

  it('blocks task materialization when module is disabled', async () => {
    await setModuleEnabled(AGENTIC_MODULE_KEY, false);
    const blockedDraftId = randomUUID();

    const res = await request(app)
      .post('/api/v1/agentic-scribe/tasks/from-drafts')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        items: [
          {
            draftType: 'follow_up',
            draftId: blockedDraftId,
            title: 'Follow-up draft: Clinical review',
            description: 'Follow-up in two weeks',
            priority: 'medium',
          },
        ],
      });

    expect(res.status).toBe(403);
    expect(res.body?.code).toBe('MODULE_DISABLED');
  });

  it('creates tasks from drafts when module is enabled', async () => {
    await setModuleEnabled(AGENTIC_MODULE_KEY, true);
    const labDraftId = randomUUID();
    const referralDraftId = randomUUID();

    const res = await request(app)
      .post('/api/v1/agentic-scribe/tasks/from-drafts')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        items: [
          {
            draftType: 'lab_order',
            draftId: labDraftId,
            title: 'Lab order draft: FBC',
            description: 'Order FBC from consultation draft',
            priority: 'high',
          },
          {
            draftType: 'referral',
            draftId: referralDraftId,
            title: 'Referral draft: Psychology',
            description: 'Refer to psychology for CBT',
            priority: 'medium',
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(Array.isArray(res.body?.createdTasks)).toBe(true);
    expect(res.body?.createdTasks).toHaveLength(2);
    expect(res.body?.createdTasks[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('keeps ambient scribe available when medical-scribe enabled but agentic-ai-scribe disabled', async () => {
    await setModuleEnabled(AGENTIC_MODULE_KEY, false);
    await setModuleEnabled(MEDICAL_MODULE_KEY, true);

    const ambient = await request(app)
      .get('/api/v1/scribe/preferences')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');
    expect(ambient.status).toBe(200);

    const agentic = await request(app)
      .post('/api/v1/agentic-scribe/drafts')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({ transcript: 'Arrange FBC and follow-up in 2 weeks.' });
    expect(agentic.status).toBe(403);
    expect(agentic.body?.code).toBe('MODULE_DISABLED');
  });

  it('blocks both ambient and agentic scribe when both modules are disabled', async () => {
    await setModuleEnabled(AGENTIC_MODULE_KEY, false);
    await setModuleEnabled(MEDICAL_MODULE_KEY, false);

    const ambient = await request(app)
      .get('/api/v1/scribe/preferences')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');
    expect(ambient.status).toBe(403);
    expect(ambient.body?.code).toBe('MODULE_DISABLED');

    const agentic = await request(app)
      .post('/api/v1/agentic-scribe/drafts')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({ transcript: 'Arrange psychology referral.' });
    expect(agentic.status).toBe(403);
    expect(agentic.body?.code).toBe('MODULE_DISABLED');
  });
});

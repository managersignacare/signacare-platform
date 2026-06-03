import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OUTBOUND_REFERRAL_SOURCE } from '@signacare/shared';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_TAG = `RFIO-${Date.now().toString().slice(-8)}`;

type Session = {
  token: string;
  clinicId: string;
  userId: string;
};

let session: Session;
const createdReferralIds: string[] = [];
const createdEpisodeIds: string[] = [];
const createdPatientIds: string[] = [];

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-CSRF-Token': 'test',
    'X-Client': 'mobile',
  };
}

async function withClinicContext<T>(
  work: (trx: Awaited<ReturnType<typeof dbAdmin.transaction>>) => Promise<T>,
): Promise<T> {
  return dbAdmin.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [session.clinicId]);
    return work(trx);
  });
}

async function seedReferral(
  suffix: string,
  source: string,
): Promise<{ referralId: string; episodeId: string }> {
  const patientId = randomUUID();
  const episodeId = randomUUID();
  const referralId = randomUUID();

  createdPatientIds.push(patientId);
  createdEpisodeIds.push(episodeId);
  createdReferralIds.push(referralId);

  await withClinicContext(async (trx) => {
    await trx('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      given_name: 'BugRFSplit',
      family_name: `${TEST_TAG}-${suffix}`,
      emr_number: `${TEST_TAG}-${suffix}`,
      date_of_birth: '1990-01-01',
      created_at: new Date(),
      updated_at: new Date(),
    });

    await trx('episodes').insert({
      id: episodeId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      primary_clinician_id: session.userId,
      episode_type: 'intake',
      presenting_problem: TEST_TAG,
      status: 'open',
      start_date: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    });

    await trx('referrals').insert({
      id: referralId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      linked_episode_id: episodeId,
      referral_number: `${TEST_TAG}-${suffix}`,
      referral_date: '2026-05-16',
      source,
      from_service: 'BUG-RF intake/outbound split test',
      from_provider_email: 'referrer@example.test',
      reason: 'Split-filter regression proof',
      urgency: 'routine',
      status: 'received',
      task_status: 'received',
      service_request_status: 'active',
      target_specialty_code: 'mental_health',
      created_by_staff_id: session.userId,
      created_at: new Date(),
      updated_at: new Date(),
    });
  });

  return { referralId, episodeId };
}

async function seedPatientOnly(suffix: string): Promise<string> {
  const patientId = randomUUID();
  createdPatientIds.push(patientId);
  await withClinicContext(async (trx) => {
    await trx('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      given_name: 'BugRFSplitCreate',
      family_name: `${TEST_TAG}-${suffix}`,
      emr_number: `${TEST_TAG}-${suffix}`,
      date_of_birth: '1993-01-01',
      created_at: new Date(),
      updated_at: new Date(),
    });
  });
  return patientId;
}

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();
});

afterAll(async () => {
  if (!READY) return;
  await withClinicContext(async (trx) => {
    if (createdReferralIds.length > 0) {
      await trx('referral_state_transitions')
        .where({ clinic_id: session.clinicId })
        .whereIn('referral_id', createdReferralIds)
        .del()
        .catch(() => undefined);
      await trx('referral_workflow_events')
        .where({ clinic_id: session.clinicId })
        .whereIn('referral_id', createdReferralIds)
        .del()
        .catch(() => undefined);
      await trx('referrals')
        .where({ clinic_id: session.clinicId })
        .whereIn('id', createdReferralIds)
        .del()
        .catch(() => undefined);
    }
    if (createdEpisodeIds.length > 0) {
      await trx('episodes').whereIn('id', createdEpisodeIds).del().catch(() => undefined);
    }
    if (createdPatientIds.length > 0) {
      await trx('patients').whereIn('id', createdPatientIds).del().catch(() => undefined);
    }
  });
});

describe.skipIf(!READY)('BUG-RF intake/outbound split', () => {
  it('GET /referrals with direction=intake excludes outbound rows', async () => {
    const intake = await seedReferral('intake', 'gp');
    const outbound = await seedReferral('outbound', OUTBOUND_REFERRAL_SOURCE);

    const res = await request(app)
      .get('/api/v1/referrals')
      .query({ direction: 'intake', page: 1, pageSize: 100 })
      .set(authHeaders(session.token));

    expect(res.status).toBe(200);
    const ids = new Set<string>((res.body?.items ?? []).map((r: { id: string }) => r.id));
    expect(ids.has(intake.referralId)).toBe(true);
    expect(ids.has(outbound.referralId)).toBe(false);
  });

  it('GET /referrals with direction=outbound returns outbound rows only', async () => {
    const intake = await seedReferral('intake-list-outbound', 'gp');
    const outbound = await seedReferral('outbound-list-outbound', OUTBOUND_REFERRAL_SOURCE);

    const res = await request(app)
      .get('/api/v1/referrals')
      .query({ direction: 'outbound', page: 1, pageSize: 100 })
      .set(authHeaders(session.token));

    expect(res.status).toBe(200);
    const ids = new Set<string>((res.body?.items ?? []).map((r: { id: string }) => r.id));
    expect(ids.has(outbound.referralId)).toBe(true);
    expect(ids.has(intake.referralId)).toBe(false);
  });

  it('GET /referrals/queue with direction=outbound excludes intake rows', async () => {
    const intake = await seedReferral('intake-queue', 'gp');
    const outbound = await seedReferral('outbound-queue', OUTBOUND_REFERRAL_SOURCE);

    const res = await request(app)
      .get('/api/v1/referrals/queue')
      .query({ direction: 'outbound', page: 1, pageSize: 100 })
      .set(authHeaders(session.token));

    expect(res.status).toBe(200);
    const ids = new Set<string>((res.body?.items ?? []).map((r: { id: string }) => r.id));
    expect(ids.has(outbound.referralId)).toBe(true);
    expect(ids.has(intake.referralId)).toBe(false);
  });

  it('POST /referrals/by-episode/:episodeId/decision routes through canonical decision command', async () => {
    const intake = await seedReferral('by-episode-decision', 'gp');

    const acceptRes = await request(app)
      .post(`/api/v1/referrals/by-episode/${intake.episodeId}/decision`)
      .set(authHeaders(session.token))
      .send({
        decision: 'accepted',
        confirmDecision: true,
        createEpisode: true,
        episodeType: 'community',
      });

    expect(acceptRes.status).toBe(200);
    expect(String(acceptRes.body?.id ?? '')).toBe(intake.referralId);
    expect(String(acceptRes.body?.status ?? '')).toBe('accepted');
    if (acceptRes.body?.linkedEpisodeId) {
      createdEpisodeIds.push(String(acceptRes.body.linkedEpisodeId));
    }

    const closedIntakeEpisode = await withClinicContext(async (trx) => (
      trx('episodes')
        .where({ id: intake.episodeId, clinic_id: session.clinicId })
        .first('status', 'closure_reason', 'closure_summary', 'end_date')
    ));

    expect(closedIntakeEpisode?.status).toBe('closed');
    expect(String(closedIntakeEpisode?.closure_reason ?? '')).toContain('Referral accepted');
    expect((closedIntakeEpisode?.closure_summary ?? '').length).toBeGreaterThanOrEqual(10);
    expect(closedIntakeEpisode?.end_date).toBeTruthy();
  });

  it('POST /referrals with direction=intake cannot leak into referral-out even if source marker is sent', async () => {
    const patientId = await seedPatientOnly('create-intake');
    const receivedDate = '2026-05-12';

    const createRes = await request(app)
      .post('/api/v1/referrals')
      .set(authHeaders(session.token))
      .send({
        direction: 'intake',
        patientId,
        referralDate: '2026-05-16',
        receivedDate,
        source: OUTBOUND_REFERRAL_SOURCE,
        fromService: 'Intake create split test',
        reason: 'Prevent outbound leakage',
        urgency: 'routine',
        targetSpecialty: 'mental_health',
      });

    expect(createRes.status).toBe(201);
    const createdId = String(createRes.body?.id ?? '');
    expect(createdId).toBeTruthy();
    createdReferralIds.push(createdId);
    if (createRes.body?.linkedEpisodeId) {
      createdEpisodeIds.push(String(createRes.body.linkedEpisodeId));
    }
    expect(String(createRes.body?.source ?? '')).not.toBe(OUTBOUND_REFERRAL_SOURCE);
    expect(new Date(String(createRes.body?.receivedAt)).toISOString().slice(0, 10)).toBe(receivedDate);

    const intakeList = await request(app)
      .get('/api/v1/referrals')
      .query({ direction: 'intake', page: 1, pageSize: 100 })
      .set(authHeaders(session.token));
    expect(intakeList.status).toBe(200);
    const intakeIds = new Set<string>((intakeList.body?.items ?? []).map((r: { id: string }) => r.id));
    expect(intakeIds.has(createdId)).toBe(true);

    const outboundList = await request(app)
      .get('/api/v1/referrals/queue')
      .query({ direction: 'outbound', page: 1, pageSize: 100 })
      .set(authHeaders(session.token));
    expect(outboundList.status).toBe(200);
    const outboundIds = new Set<string>((outboundList.body?.items ?? []).map((r: { id: string }) => r.id));
    expect(outboundIds.has(createdId)).toBe(false);
  });

  it('POST /referrals direction=intake stays intake workflow even when referral-team module is enabled', async () => {
    const hasModulesTable = await dbAdmin.schema.hasTable('clinic_modules');
    expect(hasModulesTable).toBe(true);

    const moduleKey = 'referral-team';
    const existingModule = await withClinicContext(async (trx) => (
      trx('clinic_modules')
        .where({ clinic_id: session.clinicId, module_key: moduleKey })
        .first()
    ));

    try {
      if (existingModule) {
        await withClinicContext(async (trx) => {
          await trx('clinic_modules')
            .where({ id: existingModule.id })
            .update({ is_enabled: true, updated_at: new Date() });
        });
      } else {
        await withClinicContext(async (trx) => {
          await trx('clinic_modules').insert({
            id: randomUUID(),
            clinic_id: session.clinicId,
            module_key: moduleKey,
            is_enabled: true,
            updated_at: new Date(),
          });
        });
      }

      const patientId = await seedPatientOnly('intake-team-enabled');

      const createRes = await request(app)
        .post('/api/v1/referrals')
        .set(authHeaders(session.token))
        .send({
          direction: 'intake',
          patientId,
          referralDate: '2026-05-17',
          receivedDate: '2026-05-17',
          source: 'GP fax',
          fromService: 'Intake team-module guard test',
          reason: 'Ensure intake remains on intake workflow',
          urgency: 'routine',
          targetSpecialty: 'mental_health',
        });

      expect(createRes.status).toBe(201);
      const createdId = String(createRes.body?.id ?? '');
      expect(createdId).toBeTruthy();
      createdReferralIds.push(createdId);
      if (createRes.body?.linkedEpisodeId) {
        createdEpisodeIds.push(String(createRes.body.linkedEpisodeId));
      }

      const row = await withClinicContext(async (trx) => (
        trx('referrals')
          .where({ id: createdId, clinic_id: session.clinicId })
          .first()
      ));

      expect(row).toBeTruthy();
      expect(String(row.source)).not.toBe(OUTBOUND_REFERRAL_SOURCE);
      expect(String(row.status)).toBe('received');
      expect(String(row.task_status)).toBe('received');
      expect(row.referral_mode === null || row.referral_mode === 'standard').toBe(true);

      const intakeList = await request(app)
        .get('/api/v1/referrals')
        .query({ direction: 'intake', page: 1, pageSize: 100 })
        .set(authHeaders(session.token));
      expect(intakeList.status).toBe(200);
      const intakeIds = new Set<string>((intakeList.body?.items ?? []).map((r: { id: string }) => r.id));
      expect(intakeIds.has(createdId)).toBe(true);

      const outboundList = await request(app)
        .get('/api/v1/referrals/queue')
        .query({ direction: 'outbound', page: 1, pageSize: 100 })
        .set(authHeaders(session.token));
      expect(outboundList.status).toBe(200);
      const outboundIds = new Set<string>((outboundList.body?.items ?? []).map((r: { id: string }) => r.id));
      expect(outboundIds.has(createdId)).toBe(false);
    } finally {
      if (existingModule) {
        await withClinicContext(async (trx) => {
          await trx('clinic_modules')
            .where({ id: existingModule.id })
            .update({
              is_enabled: existingModule.is_enabled,
              updated_at: new Date(),
            });
        });
      } else {
        await withClinicContext(async (trx) => {
          await trx('clinic_modules')
            .where({ clinic_id: session.clinicId, module_key: moduleKey })
            .del();
        });
      }
    }
  });
});

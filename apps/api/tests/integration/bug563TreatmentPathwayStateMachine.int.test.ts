import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_TAG = `BUG-563-${Date.now()}`;

let session: { token: string; clinicId: string; userId: string };
let patientId = '';

async function withClinicContext<T>(
  clinicId: string,
  work: (trx: Awaited<ReturnType<typeof dbAdmin.transaction>>) => Promise<T>,
): Promise<T> {
  return dbAdmin.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
    return work(trx);
  });
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-CSRF-Token': 'test',
    'X-Client': 'mobile',
  };
}

function parseMilestones(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
}

function extractCode(resBody: unknown): string | undefined {
  if (!resBody || typeof resBody !== 'object') return undefined;
  const b = resBody as { code?: unknown; error?: { code?: unknown } };
  if (typeof b.code === 'string') return b.code;
  if (b.error && typeof b.error.code === 'string') return b.error.code;
  return undefined;
}

async function createPathway(): Promise<{ id: string; lockVersion: number }> {
  const res = await request(app)
    .post('/api/v1/pathways/')
    .set(authHeaders(session.token))
    .send({
      patientId,
      pathwayType: 'cbt',
      pathwayName: 'CBT',
      name: 'CBT',
      totalSessions: 12,
      startDate: '2026-05-14',
    });

  if (res.status !== 201) {
    throw new Error(`createPathway failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return {
    id: res.body.id as string,
    lockVersion: res.body.lockVersion as number,
  };
}

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();

  patientId = randomUUID();
  await withClinicContext(session.clinicId, async (trx) => {
    await trx('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      given_name: 'Pathway',
      family_name: TEST_TAG,
      emr_number: TEST_TAG,
      date_of_birth: '1990-01-01',
      created_at: new Date(),
      updated_at: new Date(),
    });
  });
});

afterAll(async () => {
  if (!READY) return;
  await withClinicContext(session.clinicId, async (trx) => {
    await trx('treatment_pathways').where({ patient_id: patientId }).del();
    await trx('patients').where({ id: patientId }).del();
  });
});

describe.skipIf(!READY)('BUG-563 — treatment-pathway status state machine', () => {
  it('TP-PSM-1: allows active -> paused transition', async () => {
    const created = await createPathway();
    const res = await request(app)
      .patch(`/api/v1/pathways/${created.id}`)
      .set(authHeaders(session.token))
      .send({ status: 'paused', expectedLockVersion: created.lockVersion });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paused');
  });

  it('TP-PSM-2: blocks completed -> active re-open transition', async () => {
    const created = await createPathway();
    const closeRes = await request(app)
      .patch(`/api/v1/pathways/${created.id}`)
      .set(authHeaders(session.token))
      .send({ status: 'completed', expectedLockVersion: created.lockVersion });
    expect(closeRes.status).toBe(200);

    const reopenRes = await request(app)
      .patch(`/api/v1/pathways/${created.id}`)
      .set(authHeaders(session.token))
      .send({ status: 'active', expectedLockVersion: closeRes.body.lockVersion });

    expect(reopenRes.status).toBe(422);
    expect(extractCode(reopenRes.body)).toBe('INVALID_STATE_TRANSITION');

    const persisted = await withClinicContext(session.clinicId, async (trx) => (
      trx('treatment_pathways')
        .where({ id: created.id, clinic_id: session.clinicId })
        .first('status')
    ));
    expect(persisted?.status).toBe('completed');
  });

  it('TP-PSM-3: blocks discontinued -> active re-open transition', async () => {
    const created = await createPathway();
    const closeRes = await request(app)
      .patch(`/api/v1/pathways/${created.id}`)
      .set(authHeaders(session.token))
      .send({ status: 'discontinued', expectedLockVersion: created.lockVersion });
    expect(closeRes.status).toBe(200);

    const reopenRes = await request(app)
      .patch(`/api/v1/pathways/${created.id}`)
      .set(authHeaders(session.token))
      .send({ status: 'active', expectedLockVersion: closeRes.body.lockVersion });

    expect(reopenRes.status).toBe(422);
    expect(extractCode(reopenRes.body)).toBe('INVALID_STATE_TRANSITION');

    const persisted = await withClinicContext(session.clinicId, async (trx) => (
      trx('treatment_pathways')
        .where({ id: created.id, clinic_id: session.clinicId })
        .first('status')
    ));
    expect(persisted?.status).toBe('discontinued');
  });

  it('TP-PSM-4: blocks session recording against completed pathway', async () => {
    const created = await createPathway();
    const closeRes = await request(app)
      .patch(`/api/v1/pathways/${created.id}`)
      .set(authHeaders(session.token))
      .send({ status: 'completed', expectedLockVersion: created.lockVersion });
    expect(closeRes.status).toBe(200);

    const before = await withClinicContext(session.clinicId, async (trx) => (
      trx('treatment_pathways')
        .where({ id: created.id, clinic_id: session.clinicId })
        .first('status', 'milestones')
    ));
    const beforeMilestones = parseMilestones(before?.milestones);
    const beforeCompletedSessions = Number(beforeMilestones.completedSessions ?? 0);

    const sessionRes = await request(app)
      .post(`/api/v1/pathways/${created.id}/session`)
      .set(authHeaders(session.token))
      .send({ expectedLockVersion: closeRes.body.lockVersion });

    expect(sessionRes.status).toBe(422);
    expect(extractCode(sessionRes.body)).toBe('INVALID_STATE_TRANSITION');

    const after = await withClinicContext(session.clinicId, async (trx) => (
      trx('treatment_pathways')
        .where({ id: created.id, clinic_id: session.clinicId })
        .first('status', 'milestones')
    ));
    const afterMilestones = parseMilestones(after?.milestones);
    const afterCompletedSessions = Number(afterMilestones.completedSessions ?? 0);

    expect(after?.status).toBe('completed');
    expect(afterCompletedSessions).toBe(beforeCompletedSessions);
  });
});

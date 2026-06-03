/**
 * BUG-402 — Treatment-pathway optimistic-locking integration tests.
 *
 * The unit test file (`tests/unit/treatmentPathwaySchemas.test.ts`)
 * pins the Zod boundary contract. This integration suite exercises
 * the ACTUAL race-condition closure end-to-end against a live
 * Postgres + Redis stack: two concurrent PATCH `/pathways/:id` or
 * POST `/pathways/:id/session` calls observing the same lockVersion
 * must produce one 200 + one 409 OPTIMISTIC_LOCK_CONFLICT.
 *
 * Skip behaviour: degrades to "0 tests run, 0 failed" when the dev
 * compose stack is not up (per `_helpers.ts:isIntegrationReady`).
 *
 * Test cases (per locked plan §5):
 *   TP-OL-1: canonical concurrent PATCH on same pathway — first wins,
 *            second 409.
 *   TP-OL-2: PATCH with stale `expectedLockVersion` — 409.
 *   TP-OL-3: PATCH with current `expectedLockVersion` — 200, lockVersion bumped.
 *   TP-OL-4: POST `/:id/session` race — two concurrent sessions on same
 *            pathway: first +1, second 409 (NOT silent +1 +1 = +1).
 *   TP-OL-5: Cross-clinic — PATCH from clinic A with id from clinic B → 409
 *            (helper enforces clinic_id in WHERE).
 *   TP-OL-6: Same id different keys — concurrent PATCH (status) + PATCH
 *            (notes) on same row still serial; second receives 409.
 *   TP-OL-7: lock_version persists across reads — GET shows the bumped
 *            version after each successful mutation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin, TEST_ADMIN_PASSWORD } from './_helpers';

const READY = await isIntegrationReady();

let session: { token: string; clinicId: string; userId: string };
let patientId = '';
const TEST_TAG = `BUG-402-${Date.now()}`;

async function withClinicContext<T>(
  clinicId: string,
  work: (trx: Awaited<ReturnType<typeof dbAdmin.transaction>>) => Promise<T>,
): Promise<T> {
  return dbAdmin.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
    return work(trx);
  });
}

function extractDetails(
  body: unknown,
): { where?: Record<string, unknown>; expectedLockVersion?: number } | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as { details?: unknown; error?: { details?: unknown } };
  const details = b.details ?? b.error?.details;
  if (!details || typeof details !== 'object') return undefined;
  return details as { where?: Record<string, unknown>; expectedLockVersion?: number };
}

async function createPathway(): Promise<{ id: string; lockVersion: number }> {
  const res = await request(app)
    .post('/api/v1/pathways/')
    .set('Authorization', `Bearer ${session.token}`)
    .set('X-Client', 'mobile')
    .set('X-CSRF-Token', 'test')
    .send({
      patientId,
      pathwayType: 'cbt',
      pathwayName: 'CBT',
      name: 'CBT',
      totalSessions: 12,
      startDate: '2026-04-26',
    });
  if (res.status !== 201) {
    throw new Error(`createPathway failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { id: res.body.id, lockVersion: res.body.lockVersion };
}

async function loginAsOtherClinicClinician(): Promise<{ token: string; clinicId: string; userId: string }> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', 'test')
    .set('X-Client', 'mobile')
    .send({
      email: 'other@signacare.local',
      password: TEST_ADMIN_PASSWORD,
    });

  if (res.status !== 200) {
    throw new Error(`Secondary-clinic login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  const token = res.body?.accessToken as string | undefined;
  const clinicId = res.body?.user?.clinicId as string | undefined;
  const userId = res.body?.user?.id as string | undefined;
  if (!token || !clinicId || !userId) {
    throw new Error('Secondary-clinic login missing token/user metadata');
  }

  return { token, clinicId, userId };
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

describe.skipIf(!READY)('BUG-402 treatment-pathway optimistic locking', () => {
  it('TP-OL-1: canonical concurrent PATCH — first wins, second 409', async () => {
    const created = await createPathway();
    const [first, second] = await Promise.all([
      request(app)
        .patch(`/api/v1/pathways/${created.id}`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-Client', 'mobile')
        .set('X-CSRF-Token', 'test')
        .send({ status: 'completed', endDate: '2026-04-26', expectedLockVersion: created.lockVersion }),
      request(app)
        .patch(`/api/v1/pathways/${created.id}`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-Client', 'mobile')
        .set('X-CSRF-Token', 'test')
        .send({ status: 'discontinued', endDate: '2026-04-26', expectedLockVersion: created.lockVersion }),
    ]);
    const codes = [first.status, second.status].sort();
    expect(codes).toEqual([200, 409]);
    const conflict = first.status === 409 ? first : second;
    expect(conflict.body?.code ?? conflict.body?.error?.code).toBe('OPTIMISTIC_LOCK_CONFLICT');
    const details = extractDetails(conflict.body);
    expect(details?.where?.id).toBe(created.id);
    expect(Object.prototype.hasOwnProperty.call(details?.where ?? {}, 'clinic_id')).toBe(false);
  });

  it('TP-OL-2: PATCH with stale expectedLockVersion → 409', async () => {
    const created = await createPathway();
    // Burn one version with a successful PATCH
    const ok = await request(app)
      .patch(`/api/v1/pathways/${created.id}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({ notes: 'first', expectedLockVersion: created.lockVersion });
    expect(ok.status).toBe(200);
    // Stale call with the original lockVersion must 409
    const stale = await request(app)
      .patch(`/api/v1/pathways/${created.id}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({ notes: 'stale', expectedLockVersion: created.lockVersion });
    expect(stale.status).toBe(409);
    expect(stale.body?.code ?? stale.body?.error?.code).toBe('OPTIMISTIC_LOCK_CONFLICT');
  });

  it('TP-OL-3: PATCH with current expectedLockVersion → 200 with bumped lockVersion', async () => {
    const created = await createPathway();
    const res = await request(app)
      .patch(`/api/v1/pathways/${created.id}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({ notes: 'fresh', expectedLockVersion: created.lockVersion });
    expect(res.status).toBe(200);
    expect(res.body.lockVersion).toBe(created.lockVersion + 1);
  });

  it('TP-OL-4: POST /:id/session race — first +1, second 409 (not silent +1 +1 = +1)', async () => {
    const created = await createPathway();
    const [first, second] = await Promise.all([
      request(app)
        .post(`/api/v1/pathways/${created.id}/session`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-Client', 'mobile')
        .set('X-CSRF-Token', 'test')
        .send({ expectedLockVersion: created.lockVersion }),
      request(app)
        .post(`/api/v1/pathways/${created.id}/session`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-Client', 'mobile')
        .set('X-CSRF-Token', 'test')
        .send({ expectedLockVersion: created.lockVersion }),
    ]);
    const codes = [first.status, second.status].sort();
    expect(codes).toEqual([200, 409]);
    // Verify the surviving completedSessions is exactly +1, not +2 not 0.
    const winner = first.status === 200 ? first : second;
    expect(winner.body.completedSessions).toBe(1);
  });

  it('TP-OL-5: cross-clinic — PATCH from clinic A with id from clinic B → 409', async () => {
    const otherSession = await loginAsOtherClinicClinician();
    const otherPatientId = randomUUID();
    await withClinicContext(otherSession.clinicId, async (trx) => {
      await trx('patients').insert({
        id: otherPatientId,
        clinic_id: otherSession.clinicId,
        given_name: 'Cross',
        family_name: TEST_TAG,
        emr_number: `BUG402-XC-${Date.now()}`,
        date_of_birth: '1991-02-02',
        created_at: new Date(),
        updated_at: new Date(),
      });
    });

    const created = await request(app)
      .post('/api/v1/pathways/')
      .set('Authorization', `Bearer ${otherSession.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        patientId: otherPatientId,
        pathwayType: 'cbt',
        pathwayName: 'CBT',
        name: 'CBT',
        totalSessions: 12,
        startDate: '2026-04-26',
      });
    expect(created.status).toBe(201);
    const createdId = created.body?.id as string;
    const createdLockVersion = created.body?.lockVersion as number;
    try {
      const res = await request(app)
        .patch(`/api/v1/pathways/${createdId}`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-Client', 'mobile')
        .set('X-CSRF-Token', 'test')
        .send({ notes: 'cross-clinic', expectedLockVersion: createdLockVersion });
      // Either 404 (route's findById misses cross-clinic) or 409 (helper
      // misses clinic_id match) — both are acceptable defence-in-depth
      // outcomes. The contract is "no successful write".
      expect(res.status).not.toBe(200);
      expect([404, 409]).toContain(res.status);
    } finally {
      await withClinicContext(otherSession.clinicId, async (trx) => {
        await trx('treatment_pathways').where({ id: createdId }).del();
        await trx('patients').where({ id: otherPatientId }).del();
      });
    }
  });

  it('TP-OL-6: same id different keys — concurrent status + notes still serial', async () => {
    const created = await createPathway();
    const [first, second] = await Promise.all([
      request(app)
        .patch(`/api/v1/pathways/${created.id}`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-Client', 'mobile')
        .set('X-CSRF-Token', 'test')
        .send({ status: 'paused', expectedLockVersion: created.lockVersion }),
      request(app)
        .patch(`/api/v1/pathways/${created.id}`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-Client', 'mobile')
        .set('X-CSRF-Token', 'test')
        .send({ notes: 'concurrent-note', expectedLockVersion: created.lockVersion }),
    ]);
    const codes = [first.status, second.status].sort();
    expect(codes).toEqual([200, 409]);
  });

  it('TP-OL-7: lockVersion persists across reads — GET reflects bumped version', async () => {
    const created = await createPathway();
    const ok = await request(app)
      .patch(`/api/v1/pathways/${created.id}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({ notes: 'persist-test', expectedLockVersion: created.lockVersion });
    expect(ok.status).toBe(200);
    const list = await request(app)
      .get(`/api/v1/pathways/patient/${patientId}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');
    expect(list.status).toBe(200);
    const row = (
      list.body as Array<{
        id: string;
        lockVersion: number;
        pathwayType: string;
        pathwayName: string;
        totalSessions: number;
        completedSessions: number;
      }>
    ).find((r) => r.id === created.id);
    expect(row).toBeDefined();
    expect(row!.lockVersion).toBe(created.lockVersion + 1);
    expect(typeof row!.pathwayType).toBe('string');
    expect(typeof row!.pathwayName).toBe('string');
    expect(typeof row!.totalSessions).toBe('number');
    expect(typeof row!.completedSessions).toBe('number');
    expect(Object.prototype.hasOwnProperty.call(row!, 'pathway_type')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(row!, 'pathway_name')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(row!, 'total_sessions')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(row!, 'completed_sessions')).toBe(false);
  });
});

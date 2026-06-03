/**
 * BUG-565 — advance_directives optimistic-locking integration proof.
 *
 * Verifies:
 *  1. New rows start with lock_version = 1.
 *  2. PATCH with current expectedLockVersion succeeds and bumps version.
 *  3. PATCH with stale expectedLockVersion fails loud with 409.
 *  4. Concurrent PATCH calls with same expectedLockVersion produce one 200 + one 409.
 *
 * R-FIX-BUG-565-INT-CREATE-LOCK
 * R-FIX-BUG-565-INT-STALE-409
 * R-FIX-BUG-565-INT-CONCURRENT
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

let session: { token: string; clinicId: string; userId: string };
let patientId = '';

async function createDirective(): Promise<{ id: string; lockVersion: number }> {
  const res = await request(app)
    .post('/api/v1/advance-directives')
    .set('Authorization', `Bearer ${session.token}`)
    .set('X-Client', 'mobile')
    .set('X-CSRF-Token', 'test')
    .send({
      patientId,
      type: 'mental_health_advance_directive',
      status: 'active',
      documentDate: '2026-05-13',
      treatmentPreferences: 'pref-a',
    });
  expect(res.status).toBe(201);
  return { id: res.body.id as string, lockVersion: res.body.lockVersion as number };
}

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();
  patientId = randomUUID();
  await dbAdmin('patients').insert({
    id: patientId,
    clinic_id: session.clinicId,
    given_name: 'Bug565',
    family_name: `OptLock-${Date.now()}`,
    emr_number: `BUG565-${Date.now()}`,
    date_of_birth: '1991-01-01',
    created_at: new Date(),
    updated_at: new Date(),
  });
});

afterAll(async () => {
  if (!READY) return;
  await dbAdmin('advance_directives').where({ patient_id: patientId }).del();
  await dbAdmin('patients').where({ id: patientId }).del();
});

describe.skipIf(!READY)('BUG-565 advance_directives optimistic locking', () => {
  it('TP-AD-565-1: CREATE starts at lockVersion=1', async () => {
    const created = await createDirective();
    expect(created.lockVersion).toBe(1);

    const row = await dbAdmin('advance_directives')
      .where({ id: created.id, clinic_id: session.clinicId })
      .first('lock_version');
    expect(row).toBeTruthy();
    expect(row.lock_version).toBe(1);
  });

  it('TP-AD-565-2: PATCH with current expectedLockVersion bumps lockVersion', async () => {
    const created = await createDirective();
    const patched = await request(app)
      .patch(`/api/v1/advance-directives/${created.id}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        expectedLockVersion: created.lockVersion,
        notes: 'updated-note',
      });
    expect(patched.status).toBe(200);
    expect(patched.body.lockVersion).toBe(created.lockVersion + 1);
  });

  it('TP-AD-565-3: stale expectedLockVersion fails with 409', async () => {
    const created = await createDirective();

    const ok = await request(app)
      .patch(`/api/v1/advance-directives/${created.id}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        expectedLockVersion: created.lockVersion,
        notes: 'fresh',
      });
    expect(ok.status).toBe(200);

    const stale = await request(app)
      .patch(`/api/v1/advance-directives/${created.id}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        expectedLockVersion: created.lockVersion,
        notes: 'stale',
      });
    expect(stale.status).toBe(409);
    expect(stale.body?.code ?? stale.body?.error?.code).toBe('OPTIMISTIC_LOCK_CONFLICT');
  });

  it('TP-AD-565-4: concurrent PATCH writes serialize (200 + 409)', async () => {
    const created = await createDirective();

    const [first, second] = await Promise.all([
      request(app)
        .patch(`/api/v1/advance-directives/${created.id}`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-Client', 'mobile')
        .set('X-CSRF-Token', 'test')
        .send({
          expectedLockVersion: created.lockVersion,
          notes: 'first',
        }),
      request(app)
        .patch(`/api/v1/advance-directives/${created.id}`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-Client', 'mobile')
        .set('X-CSRF-Token', 'test')
        .send({
          expectedLockVersion: created.lockVersion,
          notes: 'second',
        }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
  });
});

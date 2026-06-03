/**
 * BUG-566 — legal-order optimistic-lock integration proof.
 *
 * Verifies:
 *  1. `patient_legal_orders` CREATE starts lockVersion=1.
 *  2. PATCH with current expectedLockVersion succeeds and bumps lockVersion.
 *  3. PATCH with stale expectedLockVersion fails loud with 409.
 *  4. Concurrent PATCH calls serialize as one 200 + one 409.
 *  5. `legal_orders` migration contract includes lock_version default=1.
 *
 * R-FIX-BUG-566-INT-PATIENT-LEGAL-ORDERS-LOCK
 * R-FIX-BUG-566-INT-STALE-409
 * R-FIX-BUG-566-INT-CONCURRENT
 * R-FIX-BUG-566-INT-LEGAL-ORDERS-LOCK-COLUMN
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

let session: { token: string; clinicId: string; userId: string };
let patientId = '';
let orderTypeConfigId = '';
let legalOrderTypeId = '';
const createdPatientLegalOrderIds: string[] = [];
const createdLegalOrderIds: string[] = [];

async function createPatientLegalOrder(): Promise<{ id: string; lockVersion: number }> {
  const res = await request(app)
    .post(`/api/v1/patients/${patientId}/legal-orders`)
    .set('Authorization', `Bearer ${session.token}`)
    .set('X-Client', 'mobile')
    .set('X-CSRF-Token', 'test')
    .send({
      orderTypeId: orderTypeConfigId,
      orderNumber: `BUG-566-${Date.now()}`,
      startDate: '2026-05-13',
      status: 'active',
      notes: 'bug-566-create',
    });
  expect(res.status).toBe(201);
  const id = res.body.order.id as string;
  createdPatientLegalOrderIds.push(id);
  return { id, lockVersion: res.body.order.lockVersion as number };
}

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();
  patientId = randomUUID();
  orderTypeConfigId = randomUUID();
  legalOrderTypeId = randomUUID();

  await dbAdmin('patients').insert({
    id: patientId,
    clinic_id: session.clinicId,
    given_name: 'Bug566',
    family_name: `Legal-${Date.now()}`,
    emr_number: `BUG566-${Date.now()}`,
    date_of_birth: '1990-01-01',
    created_at: new Date(),
    updated_at: new Date(),
  });

  await dbAdmin('legal_order_type_configs').insert({
    id: orderTypeConfigId,
    clinic_id: session.clinicId,
    name: `BUG-566 order-type-config ${Date.now()}`,
    category: 'compulsory_treatment',
  });

  await dbAdmin('legal_order_types').insert({
    id: legalOrderTypeId,
    code: `BUG566-${Date.now()}`,
    name: 'BUG-566 Legal Order Type',
    jurisdiction: 'NSW',
    max_duration_days: 28,
    requires_tribunal: false,
    created_at: new Date(),
    updated_at: new Date(),
  });
});

afterAll(async () => {
  if (!READY) return;
  if (createdPatientLegalOrderIds.length > 0) {
    await dbAdmin('patient_legal_orders').whereIn('id', createdPatientLegalOrderIds).del();
  }
  if (createdLegalOrderIds.length > 0) {
    await dbAdmin('legal_orders').whereIn('id', createdLegalOrderIds).del();
  }
  if (legalOrderTypeId) {
    await dbAdmin('legal_order_types').where({ id: legalOrderTypeId }).del();
  }
  if (orderTypeConfigId) {
    await dbAdmin('legal_order_type_configs').where({ id: orderTypeConfigId }).del();
  }
  if (patientId) {
    await dbAdmin('patients').where({ id: patientId }).del();
  }
});

describe.skipIf(!READY)('BUG-566 legal-order optimistic locking', () => {
  it('TP-LO-566-1: patient_legal_orders CREATE starts at lockVersion=1', async () => {
    const created = await createPatientLegalOrder();
    expect(created.lockVersion).toBe(1);

    const rowById = await dbAdmin('patient_legal_orders')
      .where({ id: created.id, clinic_id: session.clinicId })
      .first('id', 'lock_version');
    const row =
      rowById ??
      (await dbAdmin('patient_legal_orders')
        .where({ patient_id: patientId, clinic_id: session.clinicId })
        .orderBy('created_at', 'desc')
        .first('id', 'lock_version'));
    expect(row).toBeTruthy();
    expect(row.lock_version).toBe(1);
  });

  it('TP-LO-566-1b: PATCH without expectedLockVersion is rejected at boundary', async () => {
    const created = await createPatientLegalOrder();
    const res = await request(app)
      .patch(`/api/v1/patients/legal-orders/${created.id}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({ notes: 'missing-version' });
    expect(res.status).toBe(422);
  });

  it('TP-LO-566-2: PATCH with current expectedLockVersion bumps lockVersion', async () => {
    const created = await createPatientLegalOrder();
    const patched = await request(app)
      .patch(`/api/v1/patients/legal-orders/${created.id}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        expectedLockVersion: created.lockVersion,
        notes: 'updated-note',
      });
    expect(patched.status).toBe(200);
    expect(patched.body.order.lockVersion).toBe(created.lockVersion + 1);
  });

  it('TP-LO-566-3: stale expectedLockVersion fails with 409', async () => {
    const created = await createPatientLegalOrder();

    const ok = await request(app)
      .patch(`/api/v1/patients/legal-orders/${created.id}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        expectedLockVersion: created.lockVersion,
        notes: 'fresh',
      });
    expect(ok.status).toBe(200);

    const stale = await request(app)
      .patch(`/api/v1/patients/legal-orders/${created.id}`)
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

  it('TP-LO-566-4: concurrent PATCH writes serialize (200 + 409)', async () => {
    const created = await createPatientLegalOrder();

    const [first, second] = await Promise.all([
      request(app)
        .patch(`/api/v1/patients/legal-orders/${created.id}`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-Client', 'mobile')
        .set('X-CSRF-Token', 'test')
        .send({
          expectedLockVersion: created.lockVersion,
          notes: 'first',
        }),
      request(app)
        .patch(`/api/v1/patients/legal-orders/${created.id}`)
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

  it('TP-LO-566-5: legal_orders lock_version defaults to 1 (migration contract)', async () => {
    const orderId = randomUUID();
    createdLegalOrderIds.push(orderId);

    await dbAdmin('legal_orders').insert({
      id: orderId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      order_type_id: legalOrderTypeId,
      order_number: `BUG-566-LEGAL-${Date.now()}`,
      start_date: '2026-05-13',
      review_date: '2026-05-20',
      status: 'active',
      created_by_staff_id: session.userId,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const row = await dbAdmin('legal_orders')
      .where({ id: orderId, clinic_id: session.clinicId })
      .first('lock_version');
    expect(row).toBeTruthy();
    expect(row.lock_version).toBe(1);
  });
});

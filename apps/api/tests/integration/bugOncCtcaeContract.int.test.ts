/**
 * R-FIX-BUG-ONC-CTCAE-CONTRACT-INT
 */
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

let adminSession: { token: string; clinicId: string; userId: string };
let patientId = '';
let conditionId = '';
let planId = '';

beforeAll(async () => {
  if (!READY) return;
  adminSession = await loginAsAdmin();
  patientId = randomUUID();
  conditionId = randomUUID();
  planId = randomUUID();

  const now = new Date();
  await dbAdmin('patients').insert({
    id: patientId,
    clinic_id: adminSession.clinicId,
    given_name: 'Onc',
    family_name: `Ctcae-${Date.now()}`,
    emr_number: `ONC-CTCAE-${Date.now()}`,
    date_of_birth: '1989-01-01',
    created_at: now,
    updated_at: now,
  });

  await dbAdmin('primary_cancer_conditions').insert({
    id: conditionId,
    clinic_id: adminSession.clinicId,
    patient_id: patientId,
    diagnosis_date: '2026-01-01',
    stage_system: 'ajcc8',
    created_by_staff_id: adminSession.userId,
    created_at: now,
    updated_at: now,
  });

  await dbAdmin('cancer_treatment_plans').insert({
    id: planId,
    clinic_id: adminSession.clinicId,
    condition_id: conditionId,
    regimen_name: 'CTCAE Contract Plan',
    intent: 'curative',
    start_date: '2026-01-02',
    status: 'active',
    created_by_staff_id: adminSession.userId,
    created_at: now,
    updated_at: now,
  });
});

afterAll(async () => {
  if (!READY) return;
  await dbAdmin('chemo_cycles').where({ plan_id: planId }).del();
  await dbAdmin('cancer_treatment_plans').where({ id: planId }).del();
  await dbAdmin('primary_cancer_conditions').where({ id: conditionId }).del();
  await dbAdmin('patients').where({ id: patientId }).del();
});

describe.skipIf(!READY)('BUG-ONC family — CTCAE toxicity contract', () => {
  it('accepts bounded CTCAE payload (legacy numeric + structured event)', async () => {
    const res = await request(app)
      .post('/api/v1/oncology/cycles')
      .set('Authorization', `Bearer ${adminSession.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        planId,
        cycleNumber: 1,
        plannedDate: '2026-05-14',
        status: 'planned',
        toxicityCtcae: {
          nausea: 2,
          neutropenia: {
            term: 'Neutropenia',
            grade: 3,
            attribution: 'possible',
            serious: false,
            observedAt: '2026-05-14T10:00:00.000Z',
          },
        },
      });

    expect(res.status).toBe(201);
    expect(res.body?.item?.toxicityCtcae?.nausea).toBe(2);
    expect(res.body?.item?.toxicityCtcae?.neutropenia?.grade).toBe(3);
  });

  it('rejects CTCAE grade above allowed range', async () => {
    const res = await request(app)
      .post('/api/v1/oncology/cycles')
      .set('Authorization', `Bearer ${adminSession.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        planId,
        cycleNumber: 2,
        plannedDate: '2026-05-15',
        status: 'planned',
        toxicityCtcae: {
          neutropenia: {
            term: 'Neutropenia',
            grade: 7,
          },
        },
      });

    expect(res.status).toBe(422);
    expect(res.body?.code ?? res.body?.error?.code).toBe('VALIDATION_ERROR');
  });
});

import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { withTenantContext } from '../../src/shared/tenantContext';
import { CANONICAL_CLINIC_IDS, CANONICAL_PERSONAS } from '../fixtures/canonical-personas';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

let superadminToken = '';
let primaryPatientId = '';
let secondaryPatientId = '';
let secondaryConditionId = '';
let secondaryPlanId = '';

beforeAll(async () => {
  if (!READY) return;
  const admin = await loginAsAdmin();
  superadminToken = admin.token;

  primaryPatientId = randomUUID();
  secondaryPatientId = randomUUID();
  secondaryConditionId = randomUUID();
  secondaryPlanId = randomUUID();

  const now = new Date();
  await withTenantContext(CANONICAL_CLINIC_IDS.primary, () =>
    dbAdmin('patients').insert({
      id: primaryPatientId,
      clinic_id: CANONICAL_CLINIC_IDS.primary,
      given_name: 'Oncology',
      family_name: 'PrimaryTenant',
      emr_number: `ONC-PRI-${Date.now()}`,
      date_of_birth: '1986-01-01',
      created_at: now,
      updated_at: now,
    }),
  );
  await withTenantContext(CANONICAL_CLINIC_IDS.secondary, () =>
    dbAdmin('patients').insert({
      id: secondaryPatientId,
      clinic_id: CANONICAL_CLINIC_IDS.secondary,
      given_name: 'Oncology',
      family_name: 'SecondaryTenant',
      emr_number: `ONC-SEC-${Date.now()}`,
      date_of_birth: '1987-01-01',
      created_at: now,
      updated_at: now,
    }),
  );

  await withTenantContext(CANONICAL_CLINIC_IDS.secondary, () =>
    dbAdmin('primary_cancer_conditions').insert({
      id: secondaryConditionId,
      clinic_id: CANONICAL_CLINIC_IDS.secondary,
      patient_id: secondaryPatientId,
      diagnosis_date: '2026-01-01',
      stage_system: 'ajcc8',
      created_by_staff_id: CANONICAL_PERSONAS.otherClinicClinician.id,
      created_at: now,
      updated_at: now,
    }),
  );

  await withTenantContext(CANONICAL_CLINIC_IDS.secondary, () =>
    dbAdmin('cancer_treatment_plans').insert({
      id: secondaryPlanId,
      clinic_id: CANONICAL_CLINIC_IDS.secondary,
      condition_id: secondaryConditionId,
      regimen_name: 'Foreign Plan',
      intent: 'curative',
      start_date: '2026-01-02',
      status: 'active',
      created_by_staff_id: CANONICAL_PERSONAS.otherClinicClinician.id,
      created_at: now,
      updated_at: now,
    }),
  );
});

afterAll(async () => {
  if (!READY) return;
  await withTenantContext(CANONICAL_CLINIC_IDS.secondary, async () => {
    await dbAdmin('chemo_cycles').where({ plan_id: secondaryPlanId }).del();
    await dbAdmin('cancer_treatment_plans').where({ id: secondaryPlanId }).del();
    await dbAdmin('tnm_stage_groups').where({ condition_id: secondaryConditionId }).del();
    await dbAdmin('tumour_board_decisions').where({ condition_id: secondaryConditionId }).del();
    await dbAdmin('primary_cancer_conditions').where({ id: secondaryConditionId }).del();
    await dbAdmin('patients').where({ id: secondaryPatientId }).del();
  });
  await withTenantContext(CANONICAL_CLINIC_IDS.primary, () =>
    dbAdmin('patients').where({ id: primaryPatientId }).del(),
  );
});

describe.skipIf(!READY)('BUG-ONC family — clinic lineage guard on command writes', () => {
  it('rejects stage-group create when condition belongs to another clinic', async () => {
    const res = await request(app)
      .post('/api/v1/oncology/stage-groups')
      .set('Authorization', `Bearer ${superadminToken}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        conditionId: secondaryConditionId,
        t: 'T2',
        n: 'N0',
        m: 'M0',
        stageGroup: 'IIA',
      });

    expect(res.status).toBe(404);
    expect(res.body?.code ?? res.body?.error?.code).toBe('NOT_FOUND');
  });

  it('rejects cycle create when plan belongs to another clinic', async () => {
    const res = await request(app)
      .post('/api/v1/oncology/cycles')
      .set('Authorization', `Bearer ${superadminToken}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        planId: secondaryPlanId,
        cycleNumber: 1,
        plannedDate: '2026-02-01',
        status: 'planned',
      });

    expect(res.status).toBe(404);
    expect(res.body?.code ?? res.body?.error?.code).toBe('NOT_FOUND');
  });
});

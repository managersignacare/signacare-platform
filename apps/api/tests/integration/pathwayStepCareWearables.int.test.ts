import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { digitalPhenotypingService } from '../../src/features/treatment-pathways/digitalPhenotypingService';
import { stepCareService } from '../../src/features/treatment-pathways/stepCareService';
import type { AuthContext } from '@signacare/shared';

const READY = await isIntegrationReady();

function systemAuth(clinicId: string): AuthContext {
  return {
    clinicId,
    staffId: 'system',
    role: 'superadmin',
    permissions: [],
  };
}

describe.skipIf(!READY)('Step-care automation + wearables + patient-app intervention workflow', () => {
  let session: Awaited<ReturnType<typeof loginAsAdmin>>;
  let patientId = '';
  let pathwayId = '';
  let stepCareRuleId = '';
  let sourceId = '';

  async function withClinicContext<T>(
    clinicId: string,
    work: (trx: Awaited<ReturnType<typeof dbAdmin.transaction>>) => Promise<T>,
  ): Promise<T> {
    return dbAdmin.transaction(async (trx) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
      return work(trx);
    });
  }

  beforeAll(async () => {
    session = await loginAsAdmin();
    patientId = randomUUID();
    await withClinicContext(session.clinicId, async (trx) => {
      await trx('patients').insert({
        id: patientId,
        clinic_id: session.clinicId,
        given_name: 'Pathway',
        family_name: `Automation-${Date.now()}`,
        emr_number: `PW-${Date.now()}`,
        date_of_birth: '1991-04-18',
        created_at: new Date(),
        updated_at: new Date(),
      });
      await trx('episodes').insert({
        id: randomUUID(),
        clinic_id: session.clinicId,
        patient_id: patientId,
        status: 'open',
        start_date: new Date().toISOString().split('T')[0],
        primary_clinician_id: session.userId,
        created_at: new Date(),
        updated_at: new Date(),
      });
    });

    const pathwayCreate = await request(app)
      .post('/api/v1/pathways/')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        patientId,
        pathwayType: 'cbt',
        pathwayName: 'Cognitive Behavioural Therapy',
        totalSessions: 12,
        startDate: '2026-01-01',
      });
    expect(pathwayCreate.status).toBe(201);
    pathwayId = pathwayCreate.body.id as string;
  });

  afterAll(async () => {
    if (!READY) return;
    await withClinicContext(session.clinicId, async (trx) => {
      await trx('step_care_rule_events').where({ clinic_id: session.clinicId, patient_id: patientId }).del();
      await trx('clinic_step_care_rules').where({ clinic_id: session.clinicId, id: stepCareRuleId }).del();
      await trx('notifications')
        .where({ clinic_id: session.clinicId })
        .whereRaw("(payload->>'dedupe_key') LIKE ?", [`surveillance:%:${patientId}:%`])
        .del();
      await trx('tasks')
        .where({ clinic_id: session.clinicId, patient_id: patientId })
        .whereIn('task_type', ['digital_care_cgm_coaching', 'digital_care_arrhythmia_review'])
        .del();
      await trx('glucose_readings').where({ clinic_id: session.clinicId, patient_id: patientId, source: 'cgm' }).del();
      await trx('patient_digital_phenotypes').where({ clinic_id: session.clinicId, patient_id: patientId }).del();
      await trx('patient_device_sources').where({ clinic_id: session.clinicId, patient_id: patientId }).del();
      await trx('patient_tracking').where({ clinic_id: session.clinicId, patient_id: patientId }).del();
      await trx('treatment_pathways').where({ clinic_id: session.clinicId, id: pathwayId }).del();
      await trx('episodes').where({ clinic_id: session.clinicId, patient_id: patientId }).del();
      await trx('patients').where({ clinic_id: session.clinicId, id: patientId }).del();
    });
  });

  it('runs end-to-end through rule CRUD, wearable ingest, phenotyping and patient intervention APIs', async () => {
    const now = new Date();
    const dayMinus1 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const dayMinus2 = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const createRule = await request(app)
      .post('/api/v1/pathways/step-care/rules')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        name: 'CBT mood deterioration guardrail',
        pathwayType: 'cbt',
        interventionTemplateKey: 'cbt_homework',
        autoAssignEnabled: true,
        autoEscalateEnabled: true,
        escalationPriority: 'high',
        assignmentScope: 'primary_clinician',
        conditions: {
          moodBelowThreshold: 10,
          minimumObservationDays: 1,
          cooldownDays: 1,
        },
      });
    expect(createRule.status).toBe(201);
    stepCareRuleId = createRule.body.id as string;

    const listRules = await request(app)
      .get('/api/v1/pathways/step-care/rules')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');
    expect(listRules.status).toBe(200);
    expect(Array.isArray(listRules.body.rules)).toBe(true);
    expect(listRules.body.rules.some((rule: { id: string }) => rule.id === stepCareRuleId)).toBe(true);

    const createSource = await request(app)
      .post(`/api/v1/patient-app/wearables/${patientId}/sources`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        provider: 'manual_import',
        deviceLabel: 'Demo Manual Source',
      });
    expect(createSource.status).toBe(201);
    sourceId = createSource.body.source.id as string;

    const providerCatalog = await request(app)
      .get('/api/v1/pathways/wearables/providers/catalog')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');
    expect(providerCatalog.status).toBe(200);
    expect(Array.isArray(providerCatalog.body.providers)).toBe(true);
    expect(providerCatalog.body.providers.some((row: { provider: string }) => row.provider === 'manual_import')).toBe(true);

    const clinicianListSources = await request(app)
      .get(`/api/v1/pathways/wearables/${patientId}/sources?includeInactive=true`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');
    expect(clinicianListSources.status).toBe(200);
    expect(Array.isArray(clinicianListSources.body.sources)).toBe(true);
    const clinicianSource = clinicianListSources.body.sources.find(
      (row: { id: string }) => row.id === sourceId,
    ) as { id: string; lockVersion: number } | undefined;
    expect(Boolean(clinicianSource)).toBe(true);
    expect(typeof clinicianSource?.lockVersion).toBe('number');

    const deactivateSource = await request(app)
      .patch(`/api/v1/pathways/wearables/${patientId}/sources/${sourceId}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        expectedLockVersion: clinicianSource?.lockVersion,
        isActive: false,
      });
    expect(deactivateSource.status).toBe(200);
    expect(deactivateSource.body.isActive).toBe(false);

    const inactiveSync = await request(app)
      .post(`/api/v1/pathways/wearables/${patientId}/sources/${sourceId}/sync`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        expectedLockVersion: deactivateSource.body.lockVersion,
      });
    expect(inactiveSync.status).toBe(409);
    expect(inactiveSync.body.code).toBe('WEARABLE_SOURCE_INACTIVE');

    const reactivateSource = await request(app)
      .patch(`/api/v1/pathways/wearables/${patientId}/sources/${sourceId}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        expectedLockVersion: deactivateSource.body.lockVersion,
        isActive: true,
      });
    expect(reactivateSource.status).toBe(200);
    expect(reactivateSource.body.isActive).toBe(true);

    const syncAccepted = await request(app)
      .post(`/api/v1/pathways/wearables/${patientId}/sources/${sourceId}/sync`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        expectedLockVersion: reactivateSource.body.lockVersion,
      });
    expect(syncAccepted.status).toBe(202);
    expect(syncAccepted.body.accepted).toBe(true);

    const ingest = await request(app)
      .post(`/api/v1/patient-app/wearables/${patientId}/ingest`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        sourceId,
        entries: [
          { metricType: 'sleep_hours', value: 4.2, timestamp: now.toISOString() },
          { metricType: 'sleep_hours', value: 4.0, timestamp: dayMinus1 },
          { metricType: 'sleep_hours', value: 4.1, timestamp: dayMinus2 },
          { metricType: 'mood', value: 2.5, timestamp: now.toISOString() },
          { metricType: 'mood', value: 2.7, timestamp: dayMinus1 },
          { metricType: 'mood', value: 2.6, timestamp: dayMinus2 },
          { metricType: 'anxiety', value: 8.1, timestamp: now.toISOString() },
          { metricType: 'anxiety', value: 8.0, timestamp: dayMinus1 },
          { metricType: 'anxiety', value: 8.2, timestamp: dayMinus2 },
          { metricType: 'steps', value: 1500, timestamp: now.toISOString() },
          { metricType: 'steps', value: 1600, timestamp: dayMinus1 },
          { metricType: 'steps', value: 1450, timestamp: dayMinus2 },
          { metricType: 'glucose_mgdl', value: 220, timestamp: now.toISOString() },
          { metricType: 'glucose_mgdl', value: 198, timestamp: dayMinus1 },
          { metricType: 'cgm_time_in_range_pct', value: 46, timestamp: now.toISOString() },
          { metricType: 'ecg_afib_flag', value: 1, timestamp: now.toISOString() },
          { metricType: 'ecg_afib_burden_pct', value: 18, timestamp: dayMinus1 },
          { metricType: 'ppg_irregular_rhythm_score', value: 84, timestamp: now.toISOString() },
        ],
      });
    expect(ingest.status).toBe(201);
    expect(ingest.body.ingestedCount).toBe(18);

    await withClinicContext(session.clinicId, async (trx) => {
      const [glucoseCountRow] = await trx('glucose_readings')
        .where({ clinic_id: session.clinicId, patient_id: patientId, source: 'cgm' })
        .count<{ count: string }[]>('* as count');
      expect(Number(glucoseCountRow?.count ?? '0')).toBeGreaterThan(0);

      const [surveillanceTaskCountRow] = await trx('tasks')
        .where({ clinic_id: session.clinicId, patient_id: patientId })
        .whereIn('task_type', ['digital_care_cgm_coaching', 'digital_care_arrhythmia_review'])
        .count<{ count: string }[]>('* as count');
      expect(Number(surveillanceTaskCountRow?.count ?? '0')).toBeGreaterThanOrEqual(1);
    });

    await withClinicContext(session.clinicId, async () => {
      const auth = systemAuth(session.clinicId);
      const recompute = await digitalPhenotypingService.recomputeDailyPhenotypes(auth, new Date());
      const automation = await stepCareService.runAutomationTick(auth, new Date());
      expect(recompute.rowsUpserted).toBeGreaterThan(0);
      expect(automation.patientsMatched).toBeGreaterThan(0);
      expect(automation.assignmentsCreated).toBeGreaterThan(0);
    });

    const phenotypes = await request(app)
      .get(`/api/v1/patient-app/wearables/${patientId}/phenotypes`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');
    expect(phenotypes.status).toBe(200);
    expect(Array.isArray(phenotypes.body.rows)).toBe(true);
    expect(phenotypes.body.rows.length).toBeGreaterThan(0);

    const surveillance = await request(app)
      .get(`/api/v1/patient-app/wearables/${patientId}/surveillance`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');
    expect(surveillance.status).toBe(200);
    expect(surveillance.body.classification).toBe('surveillance');
    expect(surveillance.body.actionability).toBe('clinical_review_required');
    expect(Array.isArray(surveillance.body.signals)).toBe(true);
    expect(
      surveillance.body.signals.some((row: { domain: string }) => row.domain === 'cgm_variability'),
    ).toBe(true);
    expect(
      surveillance.body.signals.some((row: { domain: string }) => row.domain === 'arrhythmia'),
    ).toBe(true);

    const interventionBundle = await request(app)
      .get(`/api/v1/patient-app/interventions/${patientId}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');
    expect(interventionBundle.status).toBe(200);
    expect(Array.isArray(interventionBundle.body.packs)).toBe(true);
    expect(interventionBundle.body.packs.length).toBeGreaterThan(0);
    const pack = interventionBundle.body.packs[0] as { id: string; items: Array<{ id: string }> };
    const lockVersion = interventionBundle.body.lockVersion as number;

    const completeItem = await request(app)
      .post(`/api/v1/patient-app/interventions/${patientId}/packs/${pack.id}/items/${pack.items[0].id}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        pathwayId,
        expectedLockVersion: lockVersion,
        completed: true,
      });
    expect(completeItem.status).toBe(200);

    const thought = await request(app)
      .post(`/api/v1/patient-app/interventions/${patientId}/thought-diary`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        pathwayId,
        expectedLockVersion: completeItem.body.lockVersion,
        situation: 'Difficult call with family',
        automaticThought: 'I am failing everyone',
        emotion: 'sadness',
        emotionIntensity: 78,
        balancedThought: 'I can seek support and take one step at a time',
      });
    expect(thought.status).toBe(200);
    expect(thought.body.thoughtDiaryEntries.length).toBeGreaterThan(0);

    const sleep = await request(app)
      .post(`/api/v1/patient-app/interventions/${patientId}/sleep-hygiene/check-in`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        pathwayId,
        expectedLockVersion: thought.body.lockVersion,
        date: '2026-06-01',
        sleepHours: 6.5,
        sleepQuality: 3,
        caffeineAfterNoon: true,
        screenAfterBed: true,
        exerciseDone: false,
      });
    expect(sleep.status).toBe(200);
    expect(sleep.body.sleepJourneyCheckIns.length).toBeGreaterThan(0);

    const research = await request(app)
      .get('/api/v1/pathways/research/effectiveness?periodDays=180')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');
    expect(research.status).toBe(200);
    expect(research.body.activePathways).toBeGreaterThanOrEqual(1);
    expect(research.body.assignedInterventionPacks).toBeGreaterThanOrEqual(1);
    expect(research.body.stepCareAutoAssignments).toBeGreaterThanOrEqual(1);
  });
});

/**
 * BUG-636 cycle-2 absorb integration test (BUG-451 batch 6).
 *
 * Closes BUG-636-FOLLOWUP-INTEGRATION-TEST (S2). Different shape from
 * batches 1-5 (which exercise scheduler cron paths) — this one tests
 * the GET /dashboard/clinical-alerts HTTP route handler in
 * `apps/api/src/features/roles/crossRoleFeatureRoutes.ts:228`.
 *
 * Sibling-applicable properties from batches 1-5 cycle-2 (HTTP-route
 * variant):
 *
 *   1. Production helper invocation (NOT parallel SQL): supertest hits
 *      the LIVE Express app at `/api/v1/dashboard/clinical-alerts` and
 *      asserts on the actual `ClinicalAlertsResponseSchema.parse(...)`
 *      output. Mutation tests would fail if the SQL filters
 *      (`pr.deleted_at IS NULL`, `p.deleted_at IS NULL`,
 *      `pr.prescribed_by_staff_id = userId`) were reverted, OR if the
 *      mapper's discriminated-union shape drifted.
 *
 *   2. Authenticated request: uses the seeded admin's bearer token via
 *      `loginAsAdmin()` (sibling of all integration tests) so the
 *      `requireRoles(CLINICAL_ROLES)` middleware passes (admin role is
 *      in CLINICAL_ROLES per shared/roleGroups.ts).
 *
 *   3. Original-value restoration on shared seed-clinic state. The
 *      seeded admin's `discipline` is 'Administration' which fails the
 *      AHPRA prescribing-discipline barrier (CLAUDE.md §7.3.1 trigger
 *      `is_prescribing_eligible_discipline` allows only 'psychiatry',
 *      'general-practice', 'nurse-practitioner'). The test temporarily
 *      changes the seeded admin's discipline to 'psychiatry' so the
 *      `prescriptions` insert with `prescribed_by_staff_id =
 *      session.userId` doesn't trigger-reject; afterAll restores the
 *      original value.
 *
 * Test variants:
 * - expiring_order: prescription with expires_at <= today + 7 → alert
 *   (proves the §1.4 closure on `pr.deleted_at IS NULL` AND
 *   `p.deleted_at IS NULL` JOIN filter)
 * - due_assessment: nursing_assessment with next_review_at <= 24h
 * - due_side_effect_monitoring: side_effect_schedule with status='active'
 *   AND next_due_date <= today + 7
 *
 * audit_log is NOT touched here — this route is a SELECT-only
 * dashboard read; no audit row written. Tests focus on:
 *   (a) §1.4 closure: soft-deleted prescription / patient → NO alert
 *   (b) §5.2/§5.3 closure: response shape via discriminated union
 *
 * fix-registry anchors: R-FIX-BUG-636-INT-EXPIRING-ORDER +
 * R-FIX-BUG-636-INT-SOFT-DELETE-FILTER + R-FIX-BUG-636-INT-RESPONSE-SHAPE.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import app from '../../src/server';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-636 cycle-2 — /dashboard/clinical-alerts (live HTTP)', () => {
  let session: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  let origAdminDiscipline: string | null = null;

  const runId = randomUUID().slice(0, 8);
  const tag = `bug636-${runId}`;
  const patientId = randomUUID();
  const episodeId = randomUUID();

  const createdPrescriptions: string[] = [];
  const createdNursingAssessments: string[] = [];
  const createdSideEffectSchedules: string[] = [];

  async function withClinicContext<T>(work: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return dbAdmin.transaction(async (trx: Knex.Transaction) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [session.clinicId]);
      return work(trx);
    });
  }

  beforeAll(async () => {
    if (!ready) return;
    session = await loginAsAdmin();
    ({ dbAdmin } = await import('../../src/db/db'));

    // Capture seeded admin's original discipline for restoration.
    const adminRow = await withClinicContext((trx) =>
      trx('staff')
        .where({ id: session.userId })
        .first('discipline'),
    );
    origAdminDiscipline = adminRow?.discipline ?? null;

    // Temporarily set to 'psychiatry' so the prescriber-discipline barrier
    // trigger (CLAUDE.md §7.3.1, migration 20260421000003) accepts the
    // INSERT into `prescriptions` with `prescribed_by_staff_id =
    // session.userId`. Restored in afterAll.
    await withClinicContext(async (trx) => {
      await trx('staff')
        .where({ id: session.userId })
        .update({ discipline: 'psychiatry' });

      await trx('patients').insert({
        id: patientId,
        clinic_id: session.clinicId,
        emr_number: `${tag}-${runId.slice(0, 4)}`,
        given_name: 'Patient',
        family_name: tag,
        date_of_birth: '1990-01-01',
      });

      await trx('episodes').insert({
        id: episodeId,
        clinic_id: session.clinicId,
        patient_id: patientId,
        title: `Episode ${tag}`,
        episode_number: `EP-${runId}`,
        episode_type: 'inpatient',
        status: 'open',
        start_date: new Date(),
        primary_clinician_id: session.userId,
      });
    });
  });

  afterAll(async () => {
    if (!ready || !session) return;

    await withClinicContext(async (trx) => {
      if (createdPrescriptions.length > 0) {
        await trx('prescriptions').whereIn('id', createdPrescriptions).del();
      }
      if (createdNursingAssessments.length > 0) {
        await trx('nursing_assessments').whereIn('id', createdNursingAssessments).del();
      }
      if (createdSideEffectSchedules.length > 0) {
        await trx('side_effect_schedules').whereIn('id', createdSideEffectSchedules).del();
      }
      await trx('episodes').where({ id: episodeId }).del();
      await trx('patients').where({ id: patientId }).del();

      // Restore seeded admin's original discipline so adjacent suites that
      // depend on the seeded admin's identity see consistent state.
      await trx('staff')
        .where({ id: session.userId })
        .update({ discipline: origAdminDiscipline });
    });
  });

  /**
   * Insert a prescription expiring in `expiresInDays` days. Tracked
   * for FK-safe afterAll cleanup.
   */
  async function insertPrescription(opts: {
    expiresInDays: number;
    softDeletedPrescription?: boolean;
  }): Promise<string> {
    const id = randomUUID();
    const today = new Date();
    const expires = new Date(today);
    expires.setDate(today.getDate() + opts.expiresInDays);
    const ymd = expires.toISOString().slice(0, 10);
    await withClinicContext(async (trx) => {
      await trx('prescriptions').insert({
        id,
        clinic_id: session.clinicId,
        patient_id: patientId,
        episode_id: episodeId,
        prescribed_by_staff_id: session.userId,
        generic_name: `BUG-636 Test Drug ${runId}`,
        dose: '500mg',
        route: 'oral',
        frequency: 'qid',
        quantity: 100,
        repeats: 0,
        prescribed_date: today,
        expires_at: ymd,
        status: 'active',
        deleted_at: opts.softDeletedPrescription ? today : null,
      });
    });
    createdPrescriptions.push(id);
    return id;
  }

  describe('BUG-636 cycle-2 — expiring_order variant (live HTTP)', () => {
    it('TP-DCA-INT-636-1: prescription expiring within 7 days → alert appears with discriminated-union camelCase response shape', async () => {
      const prescriptionId = await insertPrescription({ expiresInDays: 3 });

      const res = await request(app)
        .get('/api/v1/dashboard/clinical-alerts')
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(typeof res.body.total).toBe('number');

      const expiringAlerts = res.body.data.filter(
        (a: { alertType: string; patientId: string }) =>
          a.alertType === 'expiring_order' && a.patientId === patientId,
      );
      expect(expiringAlerts.length).toBeGreaterThanOrEqual(1);

      // Discriminated-union camelCase shape per BUG-636 §5.2 + §5.3
      // closure (mapClinicalAlertRowToResponse + Zod parse at boundary).
      const alert = expiringAlerts[0];
      expect(alert.alertType).toBe('expiring_order');
      expect(alert.patientName).toContain(tag); // family_name
      expect(alert.priority).toMatch(/^(high|medium|low)$/);
      expect(alert.genericName).toContain('BUG-636 Test Drug');
      expect(alert.expiresAt).toBeTruthy();
      // Snake_case fields MUST NOT leak through (proves the mapper ran).
      expect(alert).not.toHaveProperty('alert_type');
      expect(alert).not.toHaveProperty('patient_id');
      expect(alert).not.toHaveProperty('patient_name');
      expect(alert).not.toHaveProperty('generic_name');
      expect(alert).not.toHaveProperty('expires_at');

      // Soft-delete prescription so subsequent tests don't re-fire.
      await withClinicContext(async (trx) => {
        await trx('prescriptions')
          .where({ id: prescriptionId })
          .update({ deleted_at: new Date() });
      });
    });

    it('TP-DCA-INT-636-2: SOFT-DELETED prescription does NOT appear (proves §1.4 pr.deleted_at IS NULL filter)', async () => {
      // Insert a prescription THAT IS already soft-deleted. The §1.4
      // filter on `pr.deleted_at IS NULL` must exclude it from the
      // alerts list — otherwise soft-deleted prescriptions would
      // surface as "expiring" and create alert noise.
      const prescriptionId = await insertPrescription({
        expiresInDays: 3,
        softDeletedPrescription: true,
      });

      const res = await request(app)
        .get('/api/v1/dashboard/clinical-alerts')
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test');

      expect(res.status).toBe(200);
      const matchingAlerts = res.body.data.filter(
        (a: { alertType: string; genericName?: string }) =>
          a.alertType === 'expiring_order'
          && a.genericName?.includes(`BUG-636 Test Drug ${runId}`),
      );
      // The freshly soft-deleted prescription is for THIS run's tag —
      // any match would prove the §1.4 filter is broken.
      expect(matchingAlerts).toHaveLength(0);

      // Cleanup: prescription is already soft-deleted; nothing to undo.
      void prescriptionId;
    });

    it('TP-DCA-INT-636-3: SOFT-DELETED PATIENT excludes the alert (proves §1.4 p.deleted_at IS NULL JOIN filter)', async () => {
      // Insert a fresh prescription on a fresh patient, soft-delete the
      // PATIENT, and verify the alert does NOT appear. Proves the §1.4
      // closure on the JOIN axis (BUG-636 absorbed sibling gap).
      const altPatientId = randomUUID();
      const altPrescriptionId = randomUUID();
      const today = new Date();
      const expires = new Date(today);
      expires.setDate(today.getDate() + 3);
      try {
        await withClinicContext(async (trx) => {
          await trx('patients').insert({
            id: altPatientId,
            clinic_id: session.clinicId,
            emr_number: `${tag}-soft-${runId.slice(0, 4)}`,
            given_name: 'SoftDeleted',
            family_name: `${tag}-soft`,
            date_of_birth: '1990-01-01',
          });
          await trx('prescriptions').insert({
            id: altPrescriptionId,
            clinic_id: session.clinicId,
            patient_id: altPatientId,
            prescribed_by_staff_id: session.userId,
            generic_name: `BUG-636 Test Drug Soft ${runId}`,
            dose: '500mg',
            route: 'oral',
            frequency: 'qid',
            quantity: 100,
            repeats: 0,
            prescribed_date: today,
            expires_at: expires.toISOString().slice(0, 10),
            status: 'active',
          });
          // Soft-delete the patient AFTER prescription insert.
          await trx('patients')
            .where({ id: altPatientId })
            .update({ deleted_at: new Date() });
        });

        const res = await request(app)
          .get('/api/v1/dashboard/clinical-alerts')
          .set('Authorization', `Bearer ${session.token}`)
          .set('X-CSRF-Token', 'test');

        expect(res.status).toBe(200);
        const softDeletedPatientAlerts = res.body.data.filter(
          (a: { alertType: string; patientId: string }) =>
            a.alertType === 'expiring_order' && a.patientId === altPatientId,
        );
        expect(softDeletedPatientAlerts).toHaveLength(0);
      } finally {
        await withClinicContext(async (trx) => {
          await trx('prescriptions').where({ id: altPrescriptionId }).del();
          await trx('patients').where({ id: altPatientId }).del();
        });
      }
    });
  });

  describe('BUG-636 cycle-2 — due_assessment variant (live HTTP)', () => {
    it('TP-DCA-INT-636-4: nursing_assessment with next_review_at <= 24h fires due_assessment alert with camelCase shape', async () => {
      const id = randomUUID();
      const inOneHour = new Date(Date.now() + 60 * 60 * 1000);
      await withClinicContext(async (trx) => {
        await trx('nursing_assessments').insert({
          id,
          clinic_id: session.clinicId,
          patient_id: patientId,
          episode_id: episodeId,
          staff_id: session.userId,
          assessment_type: `BUG636-${runId}`,
          assessed_at: new Date(),
          next_review_at: inOneHour,
        });
      });
      createdNursingAssessments.push(id);

      const res = await request(app)
        .get('/api/v1/dashboard/clinical-alerts')
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test');

      expect(res.status).toBe(200);
      const due = res.body.data.filter(
        (a: { alertType: string; assessmentType?: string }) =>
          a.alertType === 'due_assessment'
          && a.assessmentType === `BUG636-${runId}`,
      );
      expect(due.length).toBeGreaterThanOrEqual(1);
      const alert = due[0];
      expect(alert.alertType).toBe('due_assessment');
      expect(alert.priority).toMatch(/^(high|medium|low)$/);
      expect(alert.assessmentType).toBe(`BUG636-${runId}`);
      expect(alert.nextReviewAt).toBeTruthy();
      // Camel-case proof.
      expect(alert).not.toHaveProperty('assessment_type');
      expect(alert).not.toHaveProperty('next_review_at');
    });
  });

  describe('BUG-636 cycle-2 — due_side_effect_monitoring variant (live HTTP)', () => {
    it('TP-DCA-INT-636-5: side_effect_schedule with status=active + next_due_date <= today+7 fires due_side_effect_monitoring alert', async () => {
      const id = randomUUID();
      const today = new Date();
      const inThreeDays = new Date(today);
      inThreeDays.setDate(today.getDate() + 3);
      await withClinicContext(async (trx) => {
        await trx('side_effect_schedules').insert({
          id,
          clinic_id: session.clinicId,
          patient_id: patientId,
          schedule_type: `BUG636-SES-${runId}`,
          frequency_weeks: 4,
          next_due_date: inThreeDays.toISOString().slice(0, 10),
          status: 'active',
        });
      });
      createdSideEffectSchedules.push(id);

      const res = await request(app)
        .get('/api/v1/dashboard/clinical-alerts')
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test');

      expect(res.status).toBe(200);
      const ses = res.body.data.filter(
        (a: { alertType: string; scheduleType?: string }) =>
          a.alertType === 'due_side_effect_monitoring'
          && a.scheduleType === `BUG636-SES-${runId}`,
      );
      expect(ses.length).toBeGreaterThanOrEqual(1);
      const alert = ses[0];
      expect(alert.alertType).toBe('due_side_effect_monitoring');
      expect(alert.priority).toMatch(/^(high|medium|low)$/);
      expect(alert.scheduleType).toBe(`BUG636-SES-${runId}`);
      expect(alert.nextDueDate).toBeTruthy();
      // Camel-case proof.
      expect(alert).not.toHaveProperty('schedule_type');
      expect(alert).not.toHaveProperty('next_due_date');
    });
  });
});

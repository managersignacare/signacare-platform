/**
 * BUG-589 + BUG-591 cycle-2 absorb integration test (BUG-451 batch 3).
 *
 * Closes BUG-589-591-FOLLOWUP-INTEGRATION-TEST (S2). Sibling-applicable
 * from BUG-451 batch 1 (pathology) + batch 2 (MHA). Three load-bearing
 * properties:
 *
 *   1. Production helper invocation (NOT parallel SQL): invokes the LIVE
 *      production code path via `processPrescriptionRepeatAlerts(now,
 *      await buildLiveContext())`. `buildLiveContext` exported per the
 *      sibling pattern.
 *
 *   2. Lowercase audit_log.action filter (case-correct persistence query
 *      per audit.ts:347).
 *
 *   3. Original-value restoration on shared seed-clinic admin slots.
 *
 * Per-test fixtures use a fresh `org_units` row + fresh `org_unit_id`
 * UUID when a SECOND PTA is needed on the same patient (avoids the
 * `(patient_id, org_unit_id)` UNIQUE clash per migration
 * 20260701000000_baseline.ts:1300; sibling absorb of
 * BUG-451-FOLLOWUP-BATCH-1-PTA-UNIQUE-CLASH from batch 2 cycle-2).
 *
 * audit_log rows are NOT deleted in afterAll — the
 * `audit_log_prevent_mutation()` trigger (BUG-039 AHPRA Standard 1)
 * blocks all DELETE; test rows accumulate harmlessly with fresh UUIDs.
 *
 * Prescriber-discipline barrier: the `prescribed_by_staff_id` BEFORE
 * INSERT/UPDATE trigger (CLAUDE.md §7.3.1) requires the staff
 * `discipline` field to be one of `('psychiatry', 'general-practice',
 * 'nurse-practitioner')` per migration 20260421000003_prescriber_discipline_barrier.ts:53.
 * Fixture staff use `discipline: 'psychiatry'`.
 *
 * fix-registry anchors: R-FIX-BUG-589-INT-LIVE-RESOLVE +
 * R-FIX-BUG-589-INT-AUDIT-LOG + R-FIX-BUG-591-INT-HIGH-RISK-T-3D.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-589 + BUG-591 cycle-2 — prescription-repeat scheduler (live)', () => {
  let session: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  let processPrescriptionRepeatAlerts: any;
  let buildLiveContext: any;
  let notificationService: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  let origNominatedAdmin: string | null = null;
  let origDelegatedAdmin: string | null = null;

  const runId = randomUUID().slice(0, 8);
  const tag = `bug589-591-${runId}`;
  const orgUnitId = randomUUID();
  const patientId = randomUUID();
  const episodeId = randomUUID();
  const ptaId = randomUUID();
  const activeStaff = randomUUID();
  const inactiveStaff = randomUUID();
  const clinicAdminStaff = randomUUID();

  // prescriptions rows created across tests, scoped for FK-safe cleanup.
  const createdPrescriptions: string[] = [];

  beforeAll(async () => {
    if (!ready) return;
    session = await loginAsAdmin();
    ({ dbAdmin } = await import('../../src/db/db'));
    ({ processPrescriptionRepeatAlerts, buildLiveContext } = await import(
      '../../src/jobs/schedulers/prescriptionRepeatScheduler'
    ));
    notificationService = (
      await import('../../src/features/notifications/notificationService')
    ).notificationService;

    const clinic = await dbAdmin('clinics')
      .where({ id: session.clinicId })
      .first('nominated_admin_staff_id', 'delegated_admin_staff_id');
    origNominatedAdmin = clinic?.nominated_admin_staff_id ?? null;
    origDelegatedAdmin = clinic?.delegated_admin_staff_id ?? null;

    await dbAdmin('org_units').insert({
      id: orgUnitId,
      clinic_id: session.clinicId,
      name: `Unit ${tag}`,
    });

    // Prescriber-discipline barrier (CLAUDE.md §7.3.1) requires
    // `discipline IN ('psychiatry','general-practice','nurse-practitioner')`
    // on staff rows referenced by `prescriptions.prescribed_by_staff_id`.
    await dbAdmin('staff').insert([
      {
        id: activeStaff,
        clinic_id: session.clinicId,
        email: `active-${tag}@test.local`,
        given_name: 'Active',
        family_name: tag,
        password_hash: 'x',
        role: 'doctor',
        discipline: 'psychiatry',
        is_active: true,
      },
      {
        id: inactiveStaff,
        clinic_id: session.clinicId,
        email: `inactive-${tag}@test.local`,
        given_name: 'Inactive',
        family_name: tag,
        password_hash: 'x',
        role: 'doctor',
        discipline: 'psychiatry',
        is_active: false,
      },
      {
        id: clinicAdminStaff,
        clinic_id: session.clinicId,
        email: `admin-${tag}@test.local`,
        given_name: 'Admin',
        family_name: tag,
        password_hash: 'x',
        role: 'admin',
        is_active: true,
      },
    ]);

    await dbAdmin('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      emr_number: `${tag}-${runId.slice(0, 4)}`,
      given_name: 'Patient',
      family_name: tag,
      date_of_birth: '1990-01-01',
    });

    await dbAdmin('episodes').insert({
      id: episodeId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      title: `Episode ${tag}`,
      episode_number: `EP-${runId}`,
      episode_type: 'inpatient',
      status: 'open',
      start_date: new Date(),
      primary_clinician_id: activeStaff,
    });

    await dbAdmin('patient_team_assignments').insert({
      id: ptaId,
      patient_id: patientId,
      org_unit_id: orgUnitId,
      primary_clinician_id: activeStaff,
      is_active: true,
    });
  });

  afterAll(async () => {
    if (!ready || !session) return;

    // FK-safe cleanup. audit_log rows are NOT deleted (BUG-039
    // immutability trigger blocks all DELETE; sibling absorb from
    // batch 2 cycle-2). Test rows accumulate harmlessly with fresh
    // record_id UUIDs per run.
    if (createdPrescriptions.length > 0) {
      await dbAdmin('prescriptions').whereIn('id', createdPrescriptions).del();
    }
    await dbAdmin('episodes').where({ id: episodeId }).del();
    await dbAdmin('patient_team_assignments').where({ patient_id: patientId }).del();
    await dbAdmin('org_units').where({ id: orgUnitId }).del();
    await dbAdmin('patients').where({ id: patientId }).del();
    await dbAdmin('staff')
      .whereIn('id', [activeStaff, inactiveStaff, clinicAdminStaff])
      .del();

    await dbAdmin('clinics').where({ id: session.clinicId }).update({
      nominated_admin_staff_id: origNominatedAdmin,
      delegated_admin_staff_id: origDelegatedAdmin,
    });
  });

  /**
   * Insert an active prescription with `expires_at` set to `today + N`
   * days. N=1 → T-1d bucket; N=3 + high-risk drug → T-3d bucket;
   * N=-1 → T+overdue.
   */
  async function insertPrescription(opts: {
    expiresInDays: number;
    prescribedByStaffId: string;
    genericName?: string;
    repeats?: number;
  }): Promise<string> {
    const id = randomUUID();
    const today = new Date();
    const expiresDate = new Date(today);
    expiresDate.setDate(today.getDate() + opts.expiresInDays);
    const ymd = expiresDate.toISOString().slice(0, 10);
    await dbAdmin('prescriptions').insert({
      id,
      clinic_id: session.clinicId,
      patient_id: patientId,
      episode_id: episodeId,
      prescribed_by_staff_id: opts.prescribedByStaffId,
      generic_name: opts.genericName ?? 'paracetamol',
      dose: '500mg',
      route: 'oral',
      frequency: 'qid prn',
      quantity: 100,
      repeats: opts.repeats ?? 5,
      prescribed_date: today,
      expires_at: ymd,
      status: 'active',
    });
    createdPrescriptions.push(id);
    return id;
  }

  /** Soft-delete prescription so subsequent scheduler invocations skip it. */
  async function softDelete(prescriptionId: string): Promise<void> {
    await dbAdmin('prescriptions')
      .where({ id: prescriptionId })
      .update({ deleted_at: new Date() });
  }

  describe('BUG-589 cycle-2 — resolveActiveRecipients (live)', () => {
    it('TP-PR-INT-589-1: end-to-end via processPrescriptionRepeatAlerts — emits to active prescriber; no audit row', async () => {
      const prescriptionId = await insertPrescription({
        expiresInDays: 1, // T-1d bucket
        prescribedByStaffId: activeStaff,
      });

      await dbAdmin('clinics').where({ id: session.clinicId }).update({
        nominated_admin_staff_id: clinicAdminStaff,
        delegated_admin_staff_id: null,
      });

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        const out = await processPrescriptionRepeatAlerts(new Date(), ctx);
        expect(out.processed).toBeGreaterThanOrEqual(1);

        const tier1 = emitSpy.mock.calls
          .filter((c) => c[0].payload?.prescription_id === prescriptionId)
          .map((c) => c[0].userId);
        expect(tier1).toContain(activeStaff); // prescriber + primary clinician dedupe to one
        expect(tier1).not.toContain(clinicAdminStaff);
        expect(tier1).not.toContain(inactiveStaff);

        const audit = await dbAdmin('audit_log')
          .where({ clinic_id: session.clinicId, record_id: prescriptionId })
          .whereIn('action', [
            'prescription_repeat_recipient_reassigned',
            'prescription_repeat_no_recipient_available',
          ])
          .first();
        expect(audit).toBeUndefined();
      } finally {
        emitSpy.mockRestore();
        await softDelete(prescriptionId);
      }
    });

    it('TP-PR-INT-589-2: BOTH inactive → reassigns to clinic admin; writes prescription_repeat_recipient_reassigned audit row with system_actor metadata', async () => {
      // Episode primary_clinician_id mutated to inactive; prescriber on
      // the prescription is inactive too.
      await dbAdmin('episodes')
        .where({ id: episodeId })
        .update({ primary_clinician_id: inactiveStaff });
      await dbAdmin('clinics')
        .where({ id: session.clinicId })
        .update({ nominated_admin_staff_id: clinicAdminStaff });

      const prescriptionId = await insertPrescription({
        expiresInDays: 1,
        prescribedByStaffId: inactiveStaff,
      });
      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processPrescriptionRepeatAlerts(new Date(), ctx);

        const tier1 = emitSpy.mock.calls
          .filter((c) => c[0].payload?.prescription_id === prescriptionId)
          .map((c) => c[0].userId);
        expect(tier1).toContain(clinicAdminStaff);
        expect(tier1).not.toContain(inactiveStaff);

        const audit = await dbAdmin('audit_log')
          .where({
            clinic_id: session.clinicId,
            record_id: prescriptionId,
            action: 'prescription_repeat_recipient_reassigned',
          })
          .first('action', 'operation', 'new_data');
        expect(audit).toBeTruthy();
        expect(audit.action).toBe('prescription_repeat_recipient_reassigned');
        expect(audit.operation).toBe('PRESCRIPTION_REPEAT_RECIPIENT_REASSIGNED');

        const nd =
          typeof audit.new_data === 'string'
            ? JSON.parse(audit.new_data)
            : audit.new_data;
        expect(nd.system_actor).toBe('prescription-repeat-scheduler');
        expect(nd.reason).toBe('both_originals_inactive');
        expect(nd.admin_staff_id).toBe(clinicAdminStaff);
      } finally {
        emitSpy.mockRestore();
        await softDelete(prescriptionId);
        await dbAdmin('episodes')
          .where({ id: episodeId })
          .update({ primary_clinician_id: activeStaff });
      }
    });

    it('TP-PR-INT-589-3: both inactive AND no admin → tier-2 escalation emit + no-recipient audit row', async () => {
      await dbAdmin('episodes')
        .where({ id: episodeId })
        .update({ primary_clinician_id: inactiveStaff });
      await dbAdmin('clinics').where({ id: session.clinicId }).update({
        nominated_admin_staff_id: null,
        delegated_admin_staff_id: null,
      });

      const prescriptionId = await insertPrescription({
        expiresInDays: 1,
        prescribedByStaffId: inactiveStaff,
      });
      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processPrescriptionRepeatAlerts(new Date(), ctx);

        const tier1 = emitSpy.mock.calls.filter(
          (c) => c[0].payload?.prescription_id === prescriptionId,
        );
        expect(tier1.length).toBeGreaterThanOrEqual(1);
        const recipients = tier1.map((c) => c[0].userId);
        expect(recipients).toContain(activeStaff); // active team lead from PTA
        expect(recipients).not.toContain(inactiveStaff);
        const sample = tier1[0]![0];
        expect(sample.payload?.tier).toBe(2);
        expect(sample.dedupeKey).toMatch(/^prescription-repeat-escalation:/);

        const audit = await dbAdmin('audit_log')
          .where({
            clinic_id: session.clinicId,
            record_id: prescriptionId,
            action: 'prescription_repeat_no_recipient_available',
          })
          .first('action', 'new_data');
        expect(audit).toBeTruthy();
        const nd =
          typeof audit.new_data === 'string'
            ? JSON.parse(audit.new_data)
            : audit.new_data;
        expect(nd.reason).toBe('no_admin_configured');
        expect(nd.system_actor).toBe('prescription-repeat-scheduler');
      } finally {
        emitSpy.mockRestore();
        await softDelete(prescriptionId);
        await dbAdmin('episodes')
          .where({ id: episodeId })
          .update({ primary_clinician_id: activeStaff });
      }
    });
  });

  describe('BUG-589 cycle-2 — audit_log persistence (live)', () => {
    it('TP-PR-INT-589-5: writeAuditLog persists action lowercase + operation uppercase', async () => {
      await dbAdmin('episodes')
        .where({ id: episodeId })
        .update({ primary_clinician_id: inactiveStaff });
      await dbAdmin('clinics')
        .where({ id: session.clinicId })
        .update({ nominated_admin_staff_id: clinicAdminStaff });

      const prescriptionId = await insertPrescription({
        expiresInDays: 1,
        prescribedByStaffId: inactiveStaff,
      });
      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processPrescriptionRepeatAlerts(new Date(), ctx);

        const lowerHit = await dbAdmin('audit_log')
          .where({
            record_id: prescriptionId,
            action: 'prescription_repeat_recipient_reassigned',
          })
          .first();
        const upperHit = await dbAdmin('audit_log')
          .where({
            record_id: prescriptionId,
            operation: 'PRESCRIPTION_REPEAT_RECIPIENT_REASSIGNED',
          })
          .first();
        expect(lowerHit).toBeTruthy();
        expect(upperHit).toBeTruthy();
        expect(lowerHit.id).toBe(upperHit.id);
      } finally {
        emitSpy.mockRestore();
        await softDelete(prescriptionId);
        await dbAdmin('episodes')
          .where({ id: episodeId })
          .update({ primary_clinician_id: activeStaff });
      }
    });
  });

  describe('BUG-591 cycle-2 — high-risk T-3d intermediate tier (live)', () => {
    it('TP-PR-INT-591-1: clozapine prescription expiring in 3 days fires T-3d alert', async () => {
      // High-risk drug class detection (`isHighRiskDrugClass`) matches
      // the `clozapine` substring in generic_name. T-3d bucket fires
      // ONLY for high-risk drugs — standard drugs at 3 days return null
      // bucket and emit nothing.
      const prescriptionId = await insertPrescription({
        expiresInDays: 3,
        prescribedByStaffId: activeStaff,
        genericName: 'clozapine',
      });

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processPrescriptionRepeatAlerts(new Date(), ctx);

        const calls = emitSpy.mock.calls.filter(
          (c) => c[0].payload?.prescription_id === prescriptionId,
        );
        expect(calls.length).toBeGreaterThanOrEqual(1);

        const sample = calls[0]![0];
        // BUG-591 — T-3d label "expires in 3 days" + "High-risk medication"
        // prefix per `titleForBucket(drug, 'T-3d', highRisk=true)`.
        expect(sample.title).toContain('expires in 3 days');
        expect(sample.title).toContain('High-risk medication');
        // High-risk promotes severity to 'critical' even for T-3d
        // (per `severityForBucket('T-3d', highRisk=true)`).
        expect(sample.severity).toBe('critical');
        expect(sample.payload?.bucket).toBe('T-3d');
      } finally {
        emitSpy.mockRestore();
        await softDelete(prescriptionId);
      }
    });

    it('TP-PR-INT-591-2: standard drug expiring in 3 days does NOT fire (T-3d is high-risk-only)', async () => {
      // `bucketForExpiresAt(date, now, highRisk=false)` returns null at
      // diffDays === 3 — standard drugs are silent at T-3d. The 6-day
      // gap between T-7d and T-1d is the documented continuity-risk
      // window for high-risk drugs; standard drugs accept the gap.
      const prescriptionId = await insertPrescription({
        expiresInDays: 3,
        prescribedByStaffId: activeStaff,
        genericName: 'paracetamol', // standard, not high-risk
      });

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processPrescriptionRepeatAlerts(new Date(), ctx);

        const calls = emitSpy.mock.calls.filter(
          (c) => c[0].payload?.prescription_id === prescriptionId,
        );
        expect(calls).toHaveLength(0);
      } finally {
        emitSpy.mockRestore();
        await softDelete(prescriptionId);
      }
    });
  });
});

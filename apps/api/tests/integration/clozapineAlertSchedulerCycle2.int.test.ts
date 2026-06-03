/**
 * BUG-569 cycle-2 absorb integration test (BUG-451 batch 5).
 *
 * Closes BUG-569-FOLLOWUP-INTEGRATION-TEST (S2). Sibling-applicable
 * from BUG-451 batches 1-4 cycle-2 patterns.
 *
 * The clozapine alert scheduler is structurally simpler than its siblings
 * (no resolveActiveRecipients / writeAuditLogRow / listEscalationRecipients
 * — only listOverdue + emit). This test focuses on the §1.4 + criteria
 * fix shape:
 *   (a) ceased_date is set → no alert (ceased registrations are out of scope)
 *   (b) deleted_at is set → no alert (soft-delete filter per CLAUDE.md §1.4)
 *   (c) next_blood_due_date >= CURRENT_DATE → no alert (not-yet-overdue)
 *   (d) prescriber_staff_id IS NULL → orphan-prescriber critical alert
 *       routes to current primary clinician + clinic governance admin
 *       (BUG-569-FOLLOWUP-ORPHAN-PRESCRIBER-FALLBACK)
 *   (e) overdue + active prescriber + open episode → emit to prescriber +
 *       episode primary clinician
 *
 * Pre-fix the scheduler was a stub `export {}`. Cycle-1 landed the full
 * BUG-372a-pattern implementation. This integration test closes the
 * coverage gap with live-DB assertions.
 *
 * fix-registry anchors: R-FIX-BUG-569-INT-LIVE-OVERDUE +
 * R-FIX-BUG-569-INT-FILTERS + R-FIX-BUG-569-INT-ORPHAN-NULL-PRESCRIBER.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-569 cycle-2 — clozapine FBC overdue alert scheduler (live)', () => {
  let session: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  let processClozapineFbcOverdueAlerts: any;
  let buildLiveContext: any;
  let notificationService: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Per-suite fixtures (created once; cleaned up FK-safe in afterAll).
  const runId = randomUUID().slice(0, 8);
  const tag = `bug569-${runId}`;
  const patientId = randomUUID();
  const episodeId = randomUUID();
  const prescriberStaffId = randomUUID();
  const primaryStaffId = randomUUID();
  const governanceStaffId = randomUUID();

  let originalNominatedAdmin: string | null = null;
  let originalDelegatedAdmin: string | null = null;

  // clozapine_registrations rows created across tests.
  const createdRegistrations: string[] = [];

  beforeAll(async () => {
    if (!ready) return;
    session = await loginAsAdmin();
    ({ dbAdmin } = await import('../../src/db/db'));
    ({ processClozapineFbcOverdueAlerts, buildLiveContext } = await import(
      '../../src/jobs/schedulers/clozapineAlertScheduler'
    ));
    notificationService = (
      await import('../../src/features/notifications/notificationService')
    ).notificationService;

    await dbAdmin('staff').insert([
      {
        id: prescriberStaffId,
        clinic_id: session.clinicId,
        email: `prescriber-${tag}@test.local`,
        given_name: 'Prescriber',
        family_name: tag,
        password_hash: 'x',
        role: 'doctor',
        discipline: 'psychiatry',
        is_active: true,
      },
      {
        id: primaryStaffId,
        clinic_id: session.clinicId,
        email: `primary-${tag}@test.local`,
        given_name: 'Primary',
        family_name: tag,
        password_hash: 'x',
        role: 'doctor',
        discipline: 'psychiatry',
        is_active: true,
      },
      {
        id: governanceStaffId,
        clinic_id: session.clinicId,
        email: `governance-${tag}@test.local`,
        given_name: 'Governance',
        family_name: tag,
        password_hash: 'x',
        role: 'admin',
        discipline: 'admin',
        is_active: true,
      },
    ]);

    const clinicBefore = await dbAdmin('clinics')
      .where({ id: session.clinicId })
      .first('nominated_admin_staff_id', 'delegated_admin_staff_id');
    originalNominatedAdmin = clinicBefore?.nominated_admin_staff_id ?? null;
    originalDelegatedAdmin = clinicBefore?.delegated_admin_staff_id ?? null;
    await dbAdmin('clinics')
      .where({ id: session.clinicId })
      .update({
        nominated_admin_staff_id: governanceStaffId,
        delegated_admin_staff_id: null,
      });

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
      primary_clinician_id: primaryStaffId,
    });
  });

  afterAll(async () => {
    if (!ready || !session) return;

    if (createdRegistrations.length > 0) {
      await dbAdmin('clozapine_registrations').whereIn('id', createdRegistrations).del();
    }
    await dbAdmin('clinics')
      .where({ id: session.clinicId })
      .update({
        nominated_admin_staff_id: originalNominatedAdmin,
        delegated_admin_staff_id: originalDelegatedAdmin,
      });
    await dbAdmin('episodes').where({ id: episodeId }).del();
    await dbAdmin('patients').where({ id: patientId }).del();
    await dbAdmin('staff')
      .whereIn('id', [prescriberStaffId, primaryStaffId, governanceStaffId])
      .del();
  });

  /**
   * Insert a clozapine_registration with the given overdue/ceased/
   * deleted state. Tracks for FK-safe cleanup.
   */
  async function insertRegistration(opts: {
    daysOverdue: number; // negative → not yet overdue
    ceased?: boolean;
    softDeleted?: boolean;
    nullPrescriber?: boolean;
    lastAncDate?: Date | null;
    lastAncValue?: number | null;
    ancStatus?: string | null;
  }): Promise<string> {
    const id = randomUUID();
    const today = new Date();
    const dueDate = new Date(today);
    dueDate.setDate(today.getDate() - opts.daysOverdue);
    const dueYmd = dueDate.toISOString().slice(0, 10);

    await dbAdmin('clozapine_registrations').insert({
      id,
      clinic_id: session.clinicId,
      patient_id: patientId,
      episode_id: episodeId,
      prescriber_staff_id: opts.nullPrescriber ? null : prescriberStaffId,
      registration_date: today,
      titration_phase: 'maintenance',
      monitoring_frequency: 'weekly',
      anc_status: opts.ancStatus ?? 'normal',
      last_anc_date:
        opts.lastAncDate === undefined
          ? new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000)
          : opts.lastAncDate,
      last_anc_value: opts.lastAncValue === undefined ? 2.5 : opts.lastAncValue,
      next_blood_due_date: dueYmd,
      ceased_date: opts.ceased ? today : null,
      deleted_at: opts.softDeleted ? today : null,
      current_dose_mg: 200,
    });
    createdRegistrations.push(id);
    return id;
  }

  describe('BUG-569 cycle-2 — listOverdue + emit (live)', () => {
    it('TP-CL-INT-569-1: overdue registration with active prescriber → emits critical alert to prescriber + primary_clinician', async () => {
      const registrationId = await insertRegistration({ daysOverdue: 5 });

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        const out = await processClozapineFbcOverdueAlerts(new Date(), ctx);
        expect(out.processed).toBeGreaterThanOrEqual(1);

        const calls = emitSpy.mock.calls.filter(
          (c) => c[0].payload?.registration_id === registrationId,
        );
        // Two recipients (prescriber + primary_clinician), both active.
        expect(calls.length).toBe(2);

        const recipients = calls.map((c) => c[0].userId);
        expect(recipients).toContain(prescriberStaffId);
        expect(recipients).toContain(primaryStaffId);

        const sample = calls[0]![0];
        expect(sample.severity).toBe('critical');
        expect(sample.category).toBe('clozapine');
        expect(sample.title).toContain('Clozapine FBC overdue');
        expect(sample.title).toContain('5d'); // daysOverdue=5
        expect(sample.payload?.days_overdue).toBe(5);
        expect(sample.body).toContain('last ANC 2.5');
        expect(sample.body).toContain('Order FBC + EUC before next dose');
      } finally {
        emitSpy.mockRestore();
      }
    });

    it('TP-CL-INT-569-2: registration with ceased_date set → NO alert (ceased filter)', async () => {
      const registrationId = await insertRegistration({
        daysOverdue: 5,
        ceased: true,
      });

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processClozapineFbcOverdueAlerts(new Date(), ctx);

        const calls = emitSpy.mock.calls.filter(
          (c) => c[0].payload?.registration_id === registrationId,
        );
        // Ceased registrations are out of scope (whereNull('cr.ceased_date')).
        expect(calls).toHaveLength(0);
      } finally {
        emitSpy.mockRestore();
      }
    });

    it('TP-CL-INT-569-3: registration with deleted_at set → NO alert (CLAUDE.md §1.4 soft-delete filter)', async () => {
      const registrationId = await insertRegistration({
        daysOverdue: 5,
        softDeleted: true,
      });

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processClozapineFbcOverdueAlerts(new Date(), ctx);

        const calls = emitSpy.mock.calls.filter(
          (c) => c[0].payload?.registration_id === registrationId,
        );
        // Soft-deleted registrations are out of scope per §1.4
        // whereNull('cr.deleted_at').
        expect(calls).toHaveLength(0);
      } finally {
        emitSpy.mockRestore();
      }
    });

    it('TP-CL-INT-569-4: registration with future next_blood_due_date → NO alert (not yet overdue)', async () => {
      const registrationId = await insertRegistration({
        daysOverdue: -3, // due 3 days in the future
      });

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processClozapineFbcOverdueAlerts(new Date(), ctx);

        const calls = emitSpy.mock.calls.filter(
          (c) => c[0].payload?.registration_id === registrationId,
        );
        // whereRaw("cr.next_blood_due_date < CURRENT_DATE") excludes
        // future-dated registrations.
        expect(calls).toHaveLength(0);
      } finally {
        emitSpy.mockRestore();
      }
    });

    it('TP-CL-INT-569-5: registration with NULL prescriber_staff_id → orphan-prescriber alert to primary + governance admin', async () => {
      const registrationId = await insertRegistration({
        daysOverdue: 5,
        nullPrescriber: true,
      });

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processClozapineFbcOverdueAlerts(new Date(), ctx);

        const calls = emitSpy.mock.calls.filter(
          (c) => c[0].payload?.registration_id === registrationId,
        );
        expect(calls.length).toBe(2);
        const recipients = calls.map((c) => c[0].userId);
        expect(recipients).toContain(primaryStaffId);
        expect(recipients).toContain(governanceStaffId);
        expect(calls.every((c) => c[0].payload?.alert_kind === 'orphan_prescriber_registration')).toBe(true);
      } finally {
        emitSpy.mockRestore();
      }
    });

    it('TP-CL-INT-569-6: NEVER-drawn ANC (last_anc_date NULL) → body cites "no prior ANC on record"', async () => {
      // Edge case: registration overdue but the patient has never had
      // a recorded ANC. Body should explicitly surface this so the
      // clinician knows it's a baseline+monitoring task, not just
      // monitoring overdue.
      const registrationId = await insertRegistration({
        daysOverdue: 7,
        lastAncDate: null,
        lastAncValue: null,
        ancStatus: 'unknown',
      });

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processClozapineFbcOverdueAlerts(new Date(), ctx);

        const calls = emitSpy.mock.calls.filter(
          (c) => c[0].payload?.registration_id === registrationId,
        );
        expect(calls.length).toBeGreaterThanOrEqual(1);

        const sample = calls[0]![0];
        expect(sample.body).toContain('no prior ANC on record');
        expect(sample.payload?.last_anc_value).toBeNull();
        expect(sample.payload?.last_anc_date).toBeNull();
      } finally {
        emitSpy.mockRestore();
      }
    });
  });
});

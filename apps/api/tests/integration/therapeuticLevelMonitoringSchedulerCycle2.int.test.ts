/**
 * BUG-592 cycle-2 absorb integration test (BUG-451 batch 4).
 *
 * Closes BUG-592-FOLLOWUP-INTEGRATION-TEST (S2). Sibling-applicable
 * from BUG-451 batches 1 + 2 + 3. Three load-bearing properties:
 *
 *   1. Production helper invocation (NOT parallel SQL): invokes the LIVE
 *      production code path via `processTherapeuticLevelAlerts(now,
 *      await buildLiveContext())`. `buildLiveContext` exported from the
 *      scheduler module per the sibling pattern.
 *
 *   2. Lowercase audit_log.action filter (case-correct persistence query
 *      per audit.ts:347; v2 `operation` column carries uppercase per :340).
 *
 *   3. Original-value restoration on shared seed-clinic admin slots.
 *
 * This suite now enforces deterministic therapeutic-level thresholds for
 * the test clinic (lithium/phenytoin=90, warfarin=14) because real clinic
 * settings may be customised in shared integration DB state. Original rows
 * are restored in `afterAll`.
 *
 * Prescriber-discipline barrier: fixture staff use `discipline:
 * 'psychiatry'` per CLAUDE.md §7.3.1.
 *
 * audit_log rows are NOT deleted in afterAll — the
 * `audit_log_prevent_mutation()` trigger (BUG-039 AHPRA Standard 1)
 * blocks all DELETE; sibling absorb from batch 2.
 *
 * fix-registry anchors: R-FIX-BUG-592-INT-LIVE-OVERDUE +
 * R-FIX-BUG-592-INT-NEVER-DRAWN + R-FIX-BUG-592-INT-AUDIT-LOG.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-592 cycle-2 — therapeutic level monitoring scheduler (live)', () => {
  let session: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  let processTherapeuticLevelAlerts: any;
  let buildLiveContext: any;
  let notificationService: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  let origNominatedAdmin: string | null = null;
  let origDelegatedAdmin: string | null = null;

  const runId = randomUUID().slice(0, 8);
  const tag = `bug592-${runId}`;
  const orgUnitId = randomUUID();
  const patientId = randomUUID();
  const episodeId = randomUUID();
  const ptaId = randomUUID();
  const activeStaff = randomUUID();
  const inactiveStaff = randomUUID();
  const clinicAdminStaff = randomUUID();

  const createdPrescriptions: string[] = [];
  const createdResults: string[] = [];
  const forcedThresholds = {
    therapeutic_level_lithium_days: 90,
    therapeutic_level_warfarin_days: 14,
    therapeutic_level_phenytoin_days: 90,
  } as const;
  const forcedThresholdKeys = Object.keys(forcedThresholds);
  type ThresholdSnapshotRow = {
    threshold_key: string;
    threshold_value: number | string;
    unit: string | null;
  };
  let originalThresholdRows: ThresholdSnapshotRow[] = [];
  // pathology_orders required because pathology_results.pathology_order_id
  // is NOT NULL with FK to pathology_orders. Created on-demand per result.
  const createdOrders: string[] = [];

  beforeAll(async () => {
    if (!ready) return;
    session = await loginAsAdmin();
    ({ dbAdmin } = await import('../../src/db/db'));
    ({ processTherapeuticLevelAlerts, buildLiveContext } = await import(
      '../../src/jobs/schedulers/therapeuticLevelMonitoringScheduler'
    ));
    notificationService = (
      await import('../../src/features/notifications/notificationService')
    ).notificationService;

    const clinic = await dbAdmin('clinics')
      .where({ id: session.clinicId })
      .first('nominated_admin_staff_id', 'delegated_admin_staff_id');
    origNominatedAdmin = clinic?.nominated_admin_staff_id ?? null;
    origDelegatedAdmin = clinic?.delegated_admin_staff_id ?? null;

    originalThresholdRows = await dbAdmin('clinic_thresholds')
      .where({ clinic_id: session.clinicId })
      .whereIn('threshold_key', forcedThresholdKeys)
      .select('threshold_key', 'threshold_value', 'unit');
    for (const [thresholdKey, thresholdValue] of Object.entries(forcedThresholds)) {
      await dbAdmin('clinic_thresholds')
        .insert({
          clinic_id: session.clinicId,
          threshold_key: thresholdKey,
          threshold_value: thresholdValue,
          unit: 'days',
        })
        .onConflict(['clinic_id', 'threshold_key'])
        .merge({
          threshold_value: thresholdValue,
          unit: 'days',
        });
    }

    await dbAdmin('org_units').insert({
      id: orgUnitId,
      clinic_id: session.clinicId,
      name: `Unit ${tag}`,
    });

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

    // FK-safe cleanup. audit_log immutability per BUG-039 — no DELETE.
    if (createdResults.length > 0) {
      await dbAdmin('pathology_results').whereIn('id', createdResults).del();
    }
    if (createdOrders.length > 0) {
      await dbAdmin('pathology_orders').whereIn('id', createdOrders).del();
    }
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
    await dbAdmin('clinic_thresholds')
      .where({ clinic_id: session.clinicId })
      .whereIn('threshold_key', forcedThresholdKeys)
      .del();
    if (originalThresholdRows.length > 0) {
      await dbAdmin('clinic_thresholds').insert(
        originalThresholdRows.map((row) => ({
          clinic_id: session.clinicId,
          threshold_key: row.threshold_key,
          threshold_value: Number(row.threshold_value),
          unit: row.unit,
        })),
      );
    }
  });

  /**
   * Insert an active prescription with the given drug name + prescriber.
   * Uses unique per-row UUIDs for FK-safe cleanup.
   */
  async function insertPrescription(opts: {
    genericName: string;
    prescribedByStaffId: string;
  }): Promise<string> {
    const id = randomUUID();
    const today = new Date();
    await dbAdmin('prescriptions').insert({
      id,
      clinic_id: session.clinicId,
      patient_id: patientId,
      episode_id: episodeId,
      prescribed_by_staff_id: opts.prescribedByStaffId,
      generic_name: opts.genericName,
      dose: '500mg',
      route: 'oral',
      frequency: 'qid',
      quantity: 100,
      repeats: 5,
      prescribed_date: today,
      status: 'active',
    });
    createdPrescriptions.push(id);
    return id;
  }

  /**
   * Insert a pathology_result for the given test_code, dated `daysAgo`
   * days back. Requires inserting a parent pathology_order first
   * (pathology_results.pathology_order_id is NOT NULL FK).
   */
  async function insertPathologyResult(opts: {
    testCode: string;
    daysAgo: number;
  }): Promise<string> {
    const orderId = randomUUID();
    await dbAdmin('pathology_orders').insert({
      id: orderId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      episode_id: episodeId,
      ordered_by_id: activeStaff,
      order_number: `ORD-${runId}-${createdOrders.length + 1}`,
      panel_name: 'Therapeutic Level Panel',
      tests: [opts.testCode],
      status: 'completed',
    });
    createdOrders.push(orderId);

    const id = randomUUID();
    const ts = new Date(Date.now() - opts.daysAgo * 24 * 60 * 60 * 1000);
    await dbAdmin('pathology_results').insert({
      id,
      clinic_id: session.clinicId,
      pathology_order_id: orderId,
      patient_id: patientId,
      test_code: opts.testCode,
      test_name: `${opts.testCode} level`,
      result_value: '0.8',
      abnormal_flag: 'normal',
      result_status: 'final',
      collection_date: ts,
      result_date: ts,
      created_at: ts,
      updated_at: ts,
    });
    createdResults.push(id);
    return id;
  }

  /** Soft-delete prescription so subsequent scheduler invocations skip it. */
  async function softDelete(prescriptionId: string): Promise<void> {
    await dbAdmin('prescriptions')
      .where({ id: prescriptionId })
      .update({ deleted_at: new Date() });
  }

  describe('BUG-592 cycle-2 — listOverdueTherapeuticLevels (live)', () => {
    it('TP-TL-INT-592-1: lithium prescription with NO pathology result → NEVER-drawn alert', async () => {
      const prescriptionId = await insertPrescription({
        genericName: 'lithium',
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
        await processTherapeuticLevelAlerts(new Date(), ctx);

        const calls = emitSpy.mock.calls.filter(
          (c) => c[0].payload?.prescription_id === prescriptionId,
        );
        expect(calls.length).toBeGreaterThanOrEqual(1);

        const sample = calls[0]![0];
        // BUG-592 — NEVER-drawn case surfaces as
        // "<drug> <test_code> level NEVER drawn — baseline required"
        // (titleForTherapeuticLevel with daysSinceLastResult=null).
        expect(sample.title).toContain('NEVER drawn');
        expect(sample.title).toContain('lithium');
        expect(sample.severity).toBe('critical');
        expect(sample.payload?.drug_label).toBe('lithium');
        expect(sample.userId).toBe(activeStaff);
      } finally {
        emitSpy.mockRestore();
        await softDelete(prescriptionId);
      }
    });

    it('TP-TL-INT-592-2: lithium prescription with OLD pathology result (100 days ago) → OVERDUE alert', async () => {
      const prescriptionId = await insertPrescription({
        genericName: 'lithium',
        prescribedByStaffId: activeStaff,
      });
      // Result older than 90-day default threshold for lithium → overdue.
      // Use lowercase 'lithium' test_code; production lower(test_code)
      // = ANY(['lithium', 'lith', 'li', '14683-7']) matches.
      await insertPathologyResult({ testCode: 'lithium', daysAgo: 100 });

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processTherapeuticLevelAlerts(new Date(), ctx);

        const calls = emitSpy.mock.calls.filter(
          (c) => c[0].payload?.prescription_id === prescriptionId,
        );
        expect(calls.length).toBeGreaterThanOrEqual(1);

        const sample = calls[0]![0];
        // OVERDUE case surfaces as
        // "<drug> <test_code> level overdue (<days> days)".
        expect(sample.title).toContain('overdue');
        expect(sample.title).toContain('lithium');
        // days_since_last_result should be ~100 (could be 99/100/101
        // depending on exact insert + query timing).
        expect(sample.payload?.days_since_last_result).toBeGreaterThanOrEqual(99);
        expect(sample.payload?.days_since_last_result).toBeLessThanOrEqual(101);
      } finally {
        emitSpy.mockRestore();
        await softDelete(prescriptionId);
      }
    });

    it('TP-TL-INT-592-3: lithium prescription with RECENT result (60 days ago) → NO alert (under threshold)', async () => {
      const prescriptionId = await insertPrescription({
        genericName: 'lithium',
        prescribedByStaffId: activeStaff,
      });
      // Result newer than 90-day threshold → no alert (proves the
      // threshold-day filter is enforced; not just "any result counts").
      await insertPathologyResult({ testCode: 'lithium', daysAgo: 60 });

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processTherapeuticLevelAlerts(new Date(), ctx);

        const calls = emitSpy.mock.calls.filter(
          (c) => c[0].payload?.prescription_id === prescriptionId,
        );
        expect(calls).toHaveLength(0);
      } finally {
        emitSpy.mockRestore();
        await softDelete(prescriptionId);
      }
    });

    it('TP-TL-INT-592-4: warfarin prescription with old LOINC-coded INR (20 days ago) → OVERDUE alert (case-insensitive test_code match)', async () => {
      // Warfarin threshold = 14 days; result 20 days ago = overdue.
      // test_code = '5894-1' is the LOINC code for PT/INR — production
      // lower(test_code) = ANY(['inr', 'inr-1', '5894-1', '6301-6'])
      // matches. Pre-cycle-2 the case-sensitive English-only match
      // would have silent-zero'd LOINC codes (BUG-583 silent-zero
      // closure pattern).
      const prescriptionId = await insertPrescription({
        genericName: 'warfarin',
        prescribedByStaffId: activeStaff,
      });
      await insertPathologyResult({ testCode: '5894-1', daysAgo: 20 });

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processTherapeuticLevelAlerts(new Date(), ctx);

        const calls = emitSpy.mock.calls.filter(
          (c) => c[0].payload?.prescription_id === prescriptionId,
        );
        expect(calls.length).toBeGreaterThanOrEqual(1);

        const sample = calls[0]![0];
        expect(sample.payload?.drug_label).toBe('warfarin');
        expect(sample.title).toContain('overdue');
      } finally {
        emitSpy.mockRestore();
        await softDelete(prescriptionId);
      }
    });

    it('TP-TL-INT-592-4b: phenytoin prescription with old LOINC level (120 days ago) → OVERDUE alert', async () => {
      // BUG-592-FOLLOWUP-PHENYTOIN: 90-day default threshold and
      // LOINC 3968-5 matching must route through the shared config.
      const prescriptionId = await insertPrescription({
        genericName: 'phenytoin',
        prescribedByStaffId: activeStaff,
      });
      await insertPathologyResult({ testCode: '3968-5', daysAgo: 120 });

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processTherapeuticLevelAlerts(new Date(), ctx);

        const calls = emitSpy.mock.calls.filter(
          (c) => c[0].payload?.prescription_id === prescriptionId,
        );
        expect(calls.length).toBeGreaterThanOrEqual(1);

        const sample = calls[0]![0];
        expect(sample.payload?.drug_label).toBe('phenytoin');
        expect(sample.title).toContain('overdue');
      } finally {
        emitSpy.mockRestore();
        await softDelete(prescriptionId);
      }
    });
  });

  describe('BUG-592 cycle-2 — resolveActiveRecipients + audit_log (live)', () => {
    it('TP-TL-INT-592-5: BOTH inactive prescriber+primary → reassigns to clinic admin; writes therapeutic_level_recipient_reassigned audit row with system_actor', async () => {
      await dbAdmin('episodes')
        .where({ id: episodeId })
        .update({ primary_clinician_id: inactiveStaff });
      await dbAdmin('clinics')
        .where({ id: session.clinicId })
        .update({ nominated_admin_staff_id: clinicAdminStaff });

      // Use carbamazepine for tests 5-6 (different drug class than
      // tests 1-3 which use lithium and 4 which uses warfarin). The
      // LATERAL JOIN matches pathology_results by patient_id +
      // test_code — tests 2-3 inserted lithium results 60 + 100 days
      // ago for THIS patient, so the most-recent lithium result (60d)
      // is under the 90d threshold and a lithium prescription would
      // NOT surface as overdue. Carbamazepine has no prior results,
      // so NEVER-drawn case fires reliably.
      const prescriptionId = await insertPrescription({
        genericName: 'carbamazepine',
        prescribedByStaffId: inactiveStaff,
      });

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processTherapeuticLevelAlerts(new Date(), ctx);

        const recipients = emitSpy.mock.calls
          .filter((c) => c[0].payload?.prescription_id === prescriptionId)
          .map((c) => c[0].userId);
        expect(recipients).toContain(clinicAdminStaff);
        expect(recipients).not.toContain(inactiveStaff);

        const audit = await dbAdmin('audit_log')
          .where({
            clinic_id: session.clinicId,
            record_id: prescriptionId,
            action: 'therapeutic_level_recipient_reassigned',
          })
          .first('action', 'operation', 'new_data');
        expect(audit).toBeTruthy();
        expect(audit.action).toBe('therapeutic_level_recipient_reassigned');
        expect(audit.operation).toBe('THERAPEUTIC_LEVEL_RECIPIENT_REASSIGNED');

        const nd =
          typeof audit.new_data === 'string'
            ? JSON.parse(audit.new_data)
            : audit.new_data;
        // BUG-592 — system_actor in JSONB metadata SURVIVES the
        // audit.ts UUID-sanitiser (which NULLs `actorId:
        // 'system:therapeutic-level-monitoring-scheduler'`).
        expect(nd.system_actor).toBe('therapeutic-level-monitoring-scheduler');
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

    it('TP-TL-INT-592-6: both inactive AND no admin → tier-2 escalation emit + no-recipient audit row', async () => {
      await dbAdmin('episodes')
        .where({ id: episodeId })
        .update({ primary_clinician_id: inactiveStaff });
      // Defensive reset for shared fixture state: this case asserts
      // tier-2 fan-out to ACTIVE treating-team leads (PTA source of
      // truth), so make the row state explicit and deterministic.
      await dbAdmin('patient_team_assignments')
        .where({ id: ptaId })
        .update({ primary_clinician_id: activeStaff, is_active: true });
      await dbAdmin('clinics').where({ id: session.clinicId }).update({
        nominated_admin_staff_id: null,
        delegated_admin_staff_id: null,
      });

      // Use valproate for test 6 (4th distinct drug class — no prior
      // pathology_results in the DB for this patient → NEVER-drawn
      // case fires reliably, isolated from tests 1-5).
      const prescriptionId = await insertPrescription({
        genericName: 'valproate',
        prescribedByStaffId: inactiveStaff,
      });

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        // BUG-592 cycle-2 deterministic-time absorb: tier-2 escalation
        // is AEST-local and threshold-gated. Use 23:59 AEST so this
        // assertion stays deterministic even with higher clinic thresholds.
        const escalationDueNow = new Date('2026-05-13T13:59:00.000Z'); // 23:59 AEST
        await processTherapeuticLevelAlerts(escalationDueNow, ctx);

        const calls = emitSpy.mock.calls.filter(
          (c) => c[0].payload?.prescription_id === prescriptionId,
        );
        expect(calls.length).toBeGreaterThanOrEqual(1);
        const recipients = calls.map((c) => c[0].userId);
        expect(recipients).toContain(activeStaff); // active team lead from PTA
        expect(recipients).not.toContain(inactiveStaff);
        const sample = calls[0]![0];
        expect(sample.payload?.tier).toBe(2);
        expect(sample.dedupeKey).toMatch(/^therapeutic-level-escalation:/);

        const lowerHit = await dbAdmin('audit_log')
          .where({
            record_id: prescriptionId,
            action: 'therapeutic_level_no_recipient_available',
          })
          .first('id', 'action', 'new_data');
        const upperHit = await dbAdmin('audit_log')
          .where({
            record_id: prescriptionId,
            operation: 'THERAPEUTIC_LEVEL_NO_RECIPIENT_AVAILABLE',
          })
          .first();
        expect(lowerHit).toBeTruthy();
        expect(upperHit).toBeTruthy();
        expect(lowerHit.id).toBe(upperHit.id);

        const nd =
          typeof lowerHit.new_data === 'string'
            ? JSON.parse(lowerHit.new_data)
            : lowerHit.new_data;
        expect(nd.reason).toBe('no_admin_configured');
        expect(nd.system_actor).toBe('therapeutic-level-monitoring-scheduler');
      } finally {
        emitSpy.mockRestore();
        await softDelete(prescriptionId);
        await dbAdmin('episodes')
          .where({ id: episodeId })
          .update({ primary_clinician_id: activeStaff });
      }
    });
  });
});

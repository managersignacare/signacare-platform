/**
 * BUG-577 + BUG-578 cycle-2 absorb integration test.
 *
 * Closes BUG-577-578-FOLLOWUP-INTEGRATION-TEST (S2) AND
 * BUG-451-BATCH-1-CYCLE-2-REWRITE (S1; the cycle-1 commit 7a58385 was
 * reset --soft after L4 BLOCK + L3 REJECT for using parallel inline SQL
 * that re-implemented production logic instead of exercising it).
 *
 * Strategy (gold-standard per `feedback_gold_standard.md`):
 *
 *   1. Insert real fixtures with all FK + NOT NULL constraints satisfied
 *      (org_units before patient_team_assignments; staff with
 *      password_hash; episodes with primary_clinician_id; pathology_orders
 *      + pathology_results aged past the threshold floor).
 *
 *   2. Invoke the LIVE production code path:
 *        processPathologyCriticalAlerts(now, await buildLiveContext())
 *      `buildLiveContext` is now exported from the scheduler module.
 *      Mutation tests: revert any of `resolveActiveRecipients` /
 *      `writeAuditLogRow` / `listEscalationRecipients` / dynamic
 *      threshold label / FALLTHROUGH branch → at least one assertion
 *      fails.
 *
 *   3. Spy on `notificationService.emit` to capture emitted alerts
 *      without polluting the `notifications` table for other suites.
 *
 *   4. Query `audit_log` on the LOWERCASE `action` column (writeAuditLog
 *      lowercases at persistence per audit.ts:347; v2 `operation`
 *      column carries the uppercase literal).
 *
 *   5. Cover the FALLTHROUGH branch (both originals inactive AND no
 *      admin → silent-drop with `critical_no_recipient_available` audit
 *      row). Cover the dynamic-threshold-label branch via real
 *      `clinic_thresholds` seed data written through `dbAdmin`, then
 *      restore original threshold state in finally (no test-side context
 *      method overrides; fully live scheduler behavior).
 *
 *   6. Cleanup is FK-safe AND restores original admin-slot values
 *      (does not NULL the shared seed clinic's slots — would pollute
 *      adjacent integration suites that reuse the same seed clinic).
 *
 * Sibling-applicable test pattern for the 6 cycle-2-absorb scheduler
 * followups (BUG-584/585, BUG-589/591, BUG-592, BUG-569, BUG-636,
 * BUG-424c). The pattern's three load-bearing properties are:
 *   - Production helper invocation (not parallel SQL)
 *   - Lowercase audit_log.action filter (case-correct persistence query)
 *   - Original-value restoration (not NULL) on shared rows
 *
 * Skip behavior: degrades to "0 tests run" when integration stack
 * unavailable per `_helpers.ts:isIntegrationReady`.
 *
 * fix-registry anchors: R-FIX-BUG-577-INT-LIVE-RESOLVE +
 * R-FIX-BUG-578-INT-LIVE-ESCALATION + R-FIX-BUG-577-INT-AUDIT-LOG.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-577 + BUG-578 cycle-2 — pathology critical scheduler (live)', () => {
  let session: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  let processPathologyCriticalAlerts: any;
  let buildLiveContext: any;
  let notificationService: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Capture original admin-slot values for restoration in afterAll
  // (the shared seed clinic's slot is set by `_helpers.ts:loginAsAdmin`;
  // NULLing it pollutes adjacent suites — restore-not-null is canonical).
  let origNominatedAdmin: string | null = null;
  let origDelegatedAdmin: string | null = null;

  // Per-suite fixtures (created once; cleaned up FK-safe in afterAll).
  const runId = randomUUID().slice(0, 8);
  const tag = `bug577-578-${runId}`;
  const orgUnitId = randomUUID();
  const patientId = randomUUID();
  const episodeId = randomUUID();
  const orderId = randomUUID();
  const ptaId = randomUUID();
  const activeStaff = randomUUID();
  const inactiveStaff = randomUUID();
  const clinicAdminStaff = randomUUID();
  const teamLeadStaff = randomUUID();

  // Per-test pathology_results IDs collected for FK-safe afterAll cleanup
  // (audit_log filtered by record_id IN createdResults to scope deletes).
  const createdResults: string[] = [];

  beforeAll(async () => {
    if (!ready) return;
    session = await loginAsAdmin();
    ({ dbAdmin } = await import('../../src/db/db'));
    ({ processPathologyCriticalAlerts, buildLiveContext } = await import(
      '../../src/jobs/schedulers/pathologyCriticalScheduler'
    ));
    notificationService = (
      await import('../../src/features/notifications/notificationService')
    ).notificationService;

    // Capture original admin-slot values for restoration.
    const clinic = await dbAdmin('clinics')
      .where({ id: session.clinicId })
      .first('nominated_admin_staff_id', 'delegated_admin_staff_id');
    origNominatedAdmin = clinic?.nominated_admin_staff_id ?? null;
    origDelegatedAdmin = clinic?.delegated_admin_staff_id ?? null;

    // Insert org_unit FIRST — `patient_team_assignments.org_unit_id` FK
    // requires the parent row to exist (the cycle-1 fixture omitted this
    // and would have failed FK-violation on first execution per L4 #2).
    await dbAdmin('org_units').insert({
      id: orgUnitId,
      clinic_id: session.clinicId,
      name: `Unit ${tag}`,
    });

    // Insert 4 staff with password_hash satisfying NOT NULL (cycle-1
    // omitted password_hash and would have failed NOT NULL violation on
    // first execution per L4 #3). Email-uniqueness honoured via runId.
    await dbAdmin('staff').insert([
      {
        id: activeStaff,
        clinic_id: session.clinicId,
        email: `active-${tag}@test.local`,
        given_name: 'Active',
        family_name: tag,
        password_hash: 'x',
        role: 'doctor',
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
        is_active: false, // BUG-577 inactive-recipient path
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
      {
        id: teamLeadStaff,
        clinic_id: session.clinicId,
        email: `lead-${tag}@test.local`,
        given_name: 'TeamLead',
        family_name: tag,
        password_hash: 'x',
        role: 'doctor',
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

    // Episode covers the LEFT JOIN path — primary_clinician_id is the
    // tier-1 candidate seen by the scheduler's resolveActiveRecipients.
    await dbAdmin('episodes').insert({
      id: episodeId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      title: `Episode ${tag}`,
      episode_number: `EP-${runId}`,
      episode_type: 'inpatient',
      status: 'active',
      start_date: new Date(),
      primary_clinician_id: activeStaff,
    });

    // Pathology order is the parent of every pathology_results row this
    // suite inserts. ordered_by_id is the second tier-1 candidate.
    await dbAdmin('pathology_orders').insert({
      id: orderId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      episode_id: episodeId,
      ordered_by_id: activeStaff,
      order_number: `ORD-${runId}`,
      panel_name: 'Test Panel',
      tests: ['POTASSIUM'],
      status: 'pending',
    });

    // Team-lead assignment for tier-2 escalation tests (BUG-578).
    await dbAdmin('patient_team_assignments').insert({
      id: ptaId,
      patient_id: patientId,
      org_unit_id: orgUnitId,
      primary_clinician_id: teamLeadStaff,
      is_active: true,
    });
  });

  afterAll(async () => {
    if (!ready || !session) return;

    // FK-safe cleanup. audit_log rows are NOT deleted — the
    // `audit_log_prevent_mutation()` trigger (migration
    // 20260421000002_audit_log_immutability.ts) fires on every DELETE
    // including dbAdmin (BUG-039 AHPRA Standard 1 tamper-evidence).
    // The cycle-2 absorb originally added the audit_log .del() but
    // first-execution surfaced the trigger; absorb the cleanup-only
    // defect by accepting test rows as append-only (each test run
    // uses fresh record_id UUIDs so cross-run collision is impossible).
    // Per CLAUDE.md §11 Layer 4 the integration runner is the
    // audit-trail accumulator by design — test rows are AHPRA-immutable
    // too. Backported to batch 1 in BUG-451-FOLLOWUP-BATCH-1-PTA-UNIQUE-CLASH
    // closure (cycle-2 absorb 2026-05-02).
    if (createdResults.length > 0) {
      await dbAdmin('pathology_results').whereIn('id', createdResults).del();
    }
    await dbAdmin('pathology_orders').where({ id: orderId }).del();
    await dbAdmin('episodes').where({ id: episodeId }).del();
    await dbAdmin('patient_team_assignments').where({ patient_id: patientId }).del();
    await dbAdmin('org_units').where({ id: orgUnitId }).del();
    await dbAdmin('patients').where({ id: patientId }).del();
    await dbAdmin('staff')
      .whereIn('id', [activeStaff, inactiveStaff, clinicAdminStaff, teamLeadStaff])
      .del();

    // Restore ORIGINAL admin-slot values — never NULL the shared seed
    // clinic's slot (cycle-1 NULLed it per L4 #8 → adjacent suites that
    // reuse the seeded admin would 403). loginAsAdmin idempotently
    // re-bootstraps but only on a fresh session, not a cached one.
    await dbAdmin('clinics').where({ id: session.clinicId }).update({
      nominated_admin_staff_id: origNominatedAdmin,
      delegated_admin_staff_id: origDelegatedAdmin,
    });
  });

  /**
   * Insert a critical pathology_result aged `ageMinutes` ago. Tracked in
   * `createdResults` for FK-safe cleanup. Each row is acknowledged at
   * the END of its test in the finally block so subsequent tests'
   * scheduler invocations skip it.
   */
  async function insertResult(ageMinutes: number): Promise<string> {
    const id = randomUUID();
    const ts = new Date(Date.now() - ageMinutes * 60_000);
    await dbAdmin('pathology_results').insert({
      id,
      clinic_id: session.clinicId,
      pathology_order_id: orderId,
      patient_id: patientId,
      test_code: 'POTASSIUM',
      test_name: 'Potassium',
      result_value: '6.5',
      abnormal_flag: 'critical_high',
      result_status: 'final',
      collection_date: ts,
      result_date: ts,
      is_critical: true,
      created_at: ts,
      updated_at: ts,
    });
    createdResults.push(id);
    return id;
  }

  /** Acknowledge so subsequent scheduler invocations skip this row. */
  async function acknowledge(resultId: string): Promise<void> {
    await dbAdmin('pathology_results')
      .where({ id: resultId })
      .update({ critical_acknowledged_at: new Date() });
  }

  /**
   * Seed clinic-specific pathology escalation threshold for a single test
   * and return a restorer that puts the prior row state back.
   */
  async function seedClinicEscalationThresholdForTest(
    clinicId: string,
    thresholdMinutes: number,
  ): Promise<() => Promise<void>> {
    const thresholdKey = 'pathology_escalation_minutes';
    const existing = await dbAdmin('clinic_thresholds')
      .where({ clinic_id: clinicId, threshold_key: thresholdKey })
      .first('id', 'threshold_value');

    await dbAdmin('clinic_thresholds')
      .insert({
        id: existing?.id ?? randomUUID(),
        clinic_id: clinicId,
        threshold_key: thresholdKey,
        threshold_value: String(thresholdMinutes),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict(['clinic_id', 'threshold_key'])
      .merge({
        threshold_value: String(thresholdMinutes),
        updated_at: new Date(),
      });

    return async () => {
      if (existing) {
        await dbAdmin('clinic_thresholds')
          .where({ clinic_id: clinicId, threshold_key: thresholdKey })
          .update({
            threshold_value: String(existing.threshold_value),
            updated_at: new Date(),
          });
        return;
      }

      await dbAdmin('clinic_thresholds')
        .where({ clinic_id: clinicId, threshold_key: thresholdKey })
        .del();
    };
  }

  describe('BUG-577 cycle-2 — resolveActiveRecipients (live)', () => {
    it('TP-PA-INT-577-1: end-to-end via processPathologyCriticalAlerts — emits to active recipient; no audit row', async () => {
      const resultId = await insertResult(60);

      // Set admin slot so a later inactive-fallback test does not see
      // a stale state from a prior failed test.
      await dbAdmin('clinics').where({ id: session.clinicId }).update({
        nominated_admin_staff_id: clinicAdminStaff,
        delegated_admin_staff_id: null,
      });

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        const out = await processPathologyCriticalAlerts(new Date(), ctx);
        expect(out.processed).toBeGreaterThanOrEqual(1);

        // Tier-1 emit fired for active recipient (primary + orderer
        // both = activeStaff; deduped).
        const calls = emitSpy.mock.calls.filter(
          ([arg]) => arg.payload?.result_id === resultId,
        );
        const tier1 = calls
          .filter((c) => c[0].payload?.tier === 1)
          .map((c) => c[0].userId);
        expect(tier1).toContain(activeStaff);
        expect(tier1).not.toContain(clinicAdminStaff); // no admin reassignment
        expect(tier1).not.toContain(inactiveStaff);

        // No reassignment / no-recipient audit row written.
        const audit = await dbAdmin('audit_log')
          .where({ clinic_id: session.clinicId, record_id: resultId })
          .whereIn('action', [
            'critical_recipient_reassigned',
            'critical_no_recipient_available',
          ])
          .first();
        expect(audit).toBeUndefined();
      } finally {
        emitSpy.mockRestore();
        await acknowledge(resultId);
      }
    });

    it('TP-PA-INT-579-1: soft-deleted original episode falls back to current open-episode primary clinician', async () => {
      const fallbackStaffId = randomUUID();
      const fallbackEpisodeId = randomUUID();

      await dbAdmin('staff').insert({
        id: fallbackStaffId,
        clinic_id: session.clinicId,
        email: `bug579-${tag}-${fallbackStaffId.slice(0, 6)}@test.local`,
        given_name: 'Fallback',
        family_name: tag,
        password_hash: 'x',
        role: 'doctor',
        is_active: true,
      });

      await dbAdmin('episodes').insert({
        id: fallbackEpisodeId,
        clinic_id: session.clinicId,
        patient_id: patientId,
        title: `BUG-579 fallback ${tag}`,
        episode_number: `EP-579-${fallbackStaffId.slice(0, 6)}`,
        episode_type: 'inpatient',
        status: 'open',
        start_date: new Date(),
        primary_clinician_id: fallbackStaffId,
      });

      await dbAdmin('pathology_orders')
        .where({ id: orderId })
        .update({ ordered_by_id: inactiveStaff });
      await dbAdmin('episodes')
        .where({ id: episodeId })
        .update({
          primary_clinician_id: inactiveStaff,
          deleted_at: new Date(),
        });
      await dbAdmin('clinics')
        .where({ id: session.clinicId })
        .update({
          nominated_admin_staff_id: null,
          delegated_admin_staff_id: null,
        });

      const resultId = await insertResult(60);
      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });

      try {
        const ctx = await buildLiveContext();
        await processPathologyCriticalAlerts(new Date(), ctx);

        const tier1Recipients = emitSpy.mock.calls
          .filter(
            (c) => c[0].payload?.result_id === resultId && c[0].payload?.tier === 1,
          )
          .map((c) => c[0].userId);

        expect(tier1Recipients).toContain(fallbackStaffId);
        expect(tier1Recipients).not.toContain(inactiveStaff);
        expect(tier1Recipients).not.toContain(clinicAdminStaff);

        const dropAudit = await dbAdmin('audit_log')
          .where({
            clinic_id: session.clinicId,
            record_id: resultId,
          })
          .whereIn('action', [
            'critical_no_recipient_available',
            'critical_recipient_reassigned',
          ])
          .first('id');
        expect(dropAudit).toBeUndefined();
      } finally {
        emitSpy.mockRestore();
        await acknowledge(resultId);

        await dbAdmin('pathology_orders')
          .where({ id: orderId })
          .update({ ordered_by_id: activeStaff });
        await dbAdmin('episodes')
          .where({ id: episodeId })
          .update({
            primary_clinician_id: activeStaff,
            deleted_at: null,
          });
        await dbAdmin('clinics')
          .where({ id: session.clinicId })
          .update({
            nominated_admin_staff_id: clinicAdminStaff,
            delegated_admin_staff_id: null,
          });
        await dbAdmin('episodes').where({ id: fallbackEpisodeId }).del();
        await dbAdmin('staff').where({ id: fallbackStaffId }).del();
      }
    });

    it('TP-PA-INT-577-2: BOTH inactive → reassigns to clinic admin; writes critical_recipient_reassigned audit row with system_actor metadata', async () => {
      // Mutate orderer + episode primary to inactive for THIS test only.
      await dbAdmin('pathology_orders')
        .where({ id: orderId })
        .update({ ordered_by_id: inactiveStaff });
      await dbAdmin('episodes')
        .where({ id: episodeId })
        .update({ primary_clinician_id: inactiveStaff });
      await dbAdmin('clinics')
        .where({ id: session.clinicId })
        .update({ nominated_admin_staff_id: clinicAdminStaff });

      const resultId = await insertResult(60);
      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processPathologyCriticalAlerts(new Date(), ctx);

        // Tier-1 emit went to admin (fallback), NOT inactive originals.
        const tier1 = emitSpy.mock.calls
          .filter(
            (c) => c[0].payload?.result_id === resultId && c[0].payload?.tier === 1,
          )
          .map((c) => c[0].userId);
        expect(tier1).toContain(clinicAdminStaff);
        expect(tier1).not.toContain(inactiveStaff);

        // Audit row persisted with LOWERCASE action (writeAuditLog
        // contract per audit.ts:347). Operation column has uppercase
        // for v2 schema.
        const audit = await dbAdmin('audit_log')
          .where({
            clinic_id: session.clinicId,
            record_id: resultId,
            action: 'critical_recipient_reassigned',
          })
          .first('action', 'operation', 'new_data');
        expect(audit).toBeTruthy();
        expect(audit.action).toBe('critical_recipient_reassigned');
        // v2 `operation` column carries uppercase literal per audit.ts:340.
        expect(audit.operation).toBe('CRITICAL_RECIPIENT_REASSIGNED');

        const nd =
          typeof audit.new_data === 'string'
            ? JSON.parse(audit.new_data)
            : audit.new_data;
        // BUG-577 cycle-2 absorb-2 (L4 CONCERN-1): system_actor in
        // JSONB metadata SURVIVES the audit.ts UUID-sanitiser (which
        // NULLs `actorId: 'system:pathology-critical-scheduler'`).
        // AHPRA forensic queries filter on `new_data->>'system_actor'`.
        expect(nd.system_actor).toBe('pathology-critical-scheduler');
        expect(nd.reason).toBe('both_originals_inactive');
        expect(nd.admin_staff_id).toBe(clinicAdminStaff);
      } finally {
        emitSpy.mockRestore();
        await acknowledge(resultId);
        // Restore order + episode for subsequent tests.
        await dbAdmin('pathology_orders')
          .where({ id: orderId })
          .update({ ordered_by_id: activeStaff });
        await dbAdmin('episodes')
          .where({ id: episodeId })
          .update({ primary_clinician_id: activeStaff });
      }
    });

    it('TP-PA-INT-577-3: FALLTHROUGH — both inactive AND no admin → no tier-1 emit; writes critical_no_recipient_available audit row', async () => {
      await dbAdmin('pathology_orders')
        .where({ id: orderId })
        .update({ ordered_by_id: inactiveStaff });
      await dbAdmin('episodes')
        .where({ id: episodeId })
        .update({ primary_clinician_id: inactiveStaff });
      await dbAdmin('clinics').where({ id: session.clinicId }).update({
        nominated_admin_staff_id: null,
        delegated_admin_staff_id: null,
      });

      const resultId = await insertResult(60);
      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processPathologyCriticalAlerts(new Date(), ctx);

        // No tier-1 emit for THIS result (recipients empty + no admin).
        const tier1 = emitSpy.mock.calls.filter(
          (c) => c[0].payload?.result_id === resultId && c[0].payload?.tier === 1,
        );
        expect(tier1).toHaveLength(0);

        // Silent-drop audit row persisted (BUG-577 cycle-2 absorb L4 #2).
        const audit = await dbAdmin('audit_log')
          .where({
            clinic_id: session.clinicId,
            record_id: resultId,
            action: 'critical_no_recipient_available',
          })
          .first('action', 'new_data');
        expect(audit).toBeTruthy();
        const nd =
          typeof audit.new_data === 'string'
            ? JSON.parse(audit.new_data)
            : audit.new_data;
        expect(nd.reason).toBe('no_admin_configured');
        expect(nd.system_actor).toBe('pathology-critical-scheduler');
      } finally {
        emitSpy.mockRestore();
        await acknowledge(resultId);
        await dbAdmin('pathology_orders')
          .where({ id: orderId })
          .update({ ordered_by_id: activeStaff });
        await dbAdmin('episodes')
          .where({ id: episodeId })
          .update({ primary_clinician_id: activeStaff });
      }
    });
  });

  describe('BUG-577 cycle-2 — audit_log persistence (live)', () => {
    // The two tests above exercise audit_log persistence end-to-end
    // through the production scheduler. This describe block is retained
    // so the existing fix-registry anchor `R-FIX-BUG-577-INT-AUDIT-LOG`
    // (which pins on the describe-string literal) keeps matching after
    // the cycle-2 rewrite. The single test verifies that the audit_log
    // row is queryable by lowercase action AND that the v2 `operation`
    // column carries the uppercase literal — the schema-shape contract
    // any sibling scheduler integration test must rely on.
    it('TP-PA-INT-577-5: writeAuditLog persists action lowercase + operation uppercase', async () => {
      // Drive a reassignment via the production code path; assert both
      // column shapes co-exist (the BUG-451-batch-1-cycle-1 case-mismatch
      // bug would have hidden every reassignment from the lowercase
      // query — proving the contract here makes sibling test design safe).
      await dbAdmin('pathology_orders')
        .where({ id: orderId })
        .update({ ordered_by_id: inactiveStaff });
      await dbAdmin('episodes')
        .where({ id: episodeId })
        .update({ primary_clinician_id: inactiveStaff });
      await dbAdmin('clinics')
        .where({ id: session.clinicId })
        .update({ nominated_admin_staff_id: clinicAdminStaff });

      const resultId = await insertResult(60);
      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processPathologyCriticalAlerts(new Date(), ctx);

        const lowerHit = await dbAdmin('audit_log')
          .where({ record_id: resultId, action: 'critical_recipient_reassigned' })
          .first();
        const upperHit = await dbAdmin('audit_log')
          .where({ record_id: resultId, operation: 'CRITICAL_RECIPIENT_REASSIGNED' })
          .first();
        expect(lowerHit).toBeTruthy();
        expect(upperHit).toBeTruthy();
        expect(lowerHit.id).toBe(upperHit.id); // same row, both column shapes
      } finally {
        emitSpy.mockRestore();
        await acknowledge(resultId);
        await dbAdmin('pathology_orders')
          .where({ id: orderId })
          .update({ ordered_by_id: activeStaff });
        await dbAdmin('episodes')
          .where({ id: episodeId })
          .update({ primary_clinician_id: activeStaff });
      }
    });
  });

  describe('BUG-578 cycle-2 — listEscalationRecipients (live)', () => {
    it('TP-PA-INT-578-1: tier-2 escalation uses dynamic threshold label, NOT hardcoded "2h+"', async () => {
      // Result aged 35 min — below default 120 (no tier-2 with default),
      // above configured 30 (tier-2 fires with per-clinic threshold).
      const resultId = await insertResult(35);
      const restoreEscalationThreshold = await seedClinicEscalationThresholdForTest(
        session.clinicId,
        30,
      );

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processPathologyCriticalAlerts(new Date(), ctx);

        const tier2Calls = emitSpy.mock.calls.filter(
          (c) => c[0].payload?.result_id === resultId && c[0].payload?.tier === 2,
        );
        expect(tier2Calls.length).toBeGreaterThanOrEqual(1);

        const sample = tier2Calls[0]![0];
        // BUG-578 cycle-2 absorb-2 (L4 CONCERN-2): dynamic label uses
        // ACTUAL per-clinic threshold. 30 % 60 !== 0 → "30min+", NOT
        // "2h+". Hardcoded "2h+" would mislead a 30-min-configured
        // clinic that the result has been unacknowledged 4× longer
        // than it actually has.
        expect(sample.title).toContain('30min+');
        expect(sample.title).not.toContain('2h+');
        expect(sample.body).toContain('30min+');
      } finally {
        emitSpy.mockRestore();
        await acknowledge(resultId);
        await restoreEscalationThreshold();
      }
    });

    it('TP-PA-INT-578-2: listEscalationRecipients filters out inactive team-leads (live SQL)', async () => {
      // Add a SECOND team-lead assignment with the inactive staff.
      // Production listEscalationRecipients must filter the inactive row
      // via the s.is_active=true + deleted_at IS NULL JOIN.
      //
      // BUG-451-FOLLOWUP-BATCH-1-PTA-UNIQUE-CLASH absorb (2026-05-02):
      // `patient_team_assignments` has UNIQUE (patient_id, org_unit_id)
      // per migration 20260701000000_baseline.ts:1300. beforeAll already
      // inserts (patientId, orgUnitId) — this test's additional PTA MUST
      // use a NEW org_unit (with its own org_units row) or the INSERT
      // throws unique_violation on first execution against a live DB.
      // L3 cycle-1 of BUG-451 batch 2 surfaced this defect; backported
      // here so the precedent is repaired before the 5 remaining
      // sibling FOLLOWUPs (BUG-589/591, BUG-592, BUG-569, BUG-636,
      // BUG-424c) copy the template.
      const ptaId2 = randomUUID();
      const orgUnitId2 = randomUUID();
      await dbAdmin('org_units').insert({
        id: orgUnitId2,
        clinic_id: session.clinicId,
        name: `Unit-578-2 ${tag}`,
      });
      await dbAdmin('patient_team_assignments').insert({
        id: ptaId2,
        patient_id: patientId,
        org_unit_id: orgUnitId2,
        primary_clinician_id: inactiveStaff,
        is_active: true,
      });
      try {
        const ctx = await buildLiveContext();
        const recipients = await ctx.listEscalationRecipients(
          session.clinicId,
          patientId,
        );
        expect(recipients).toContain(teamLeadStaff);
        expect(recipients).not.toContain(inactiveStaff);
      } finally {
        await dbAdmin('patient_team_assignments').where({ id: ptaId2 }).del();
        await dbAdmin('org_units').where({ id: orgUnitId2 }).del();
      }
    });

    it('TP-PA-INT-578-3: listEscalationRecipients filters out inactive patient_team_assignments rows (live SQL)', async () => {
      // Add a team-lead assignment with pta.is_active = false. Active
      // staff but inactive assignment — must be filtered.
      //
      // BUG-451-FOLLOWUP-BATCH-1-PTA-UNIQUE-CLASH absorb: per-test
      // org_units row required to avoid PTA unique_violation. See
      // TP-PA-INT-578-2 absorb note above.
      const ptaId3 = randomUUID();
      const orgUnitId3 = randomUUID();
      const otherActiveStaff = randomUUID();
      await dbAdmin('org_units').insert({
        id: orgUnitId3,
        clinic_id: session.clinicId,
        name: `Unit-578-3 ${tag}`,
      });
      await dbAdmin('staff').insert({
        id: otherActiveStaff,
        clinic_id: session.clinicId,
        email: `other-${tag}@test.local`,
        given_name: 'Other',
        family_name: tag,
        password_hash: 'x',
        role: 'doctor',
        is_active: true,
      });
      await dbAdmin('patient_team_assignments').insert({
        id: ptaId3,
        patient_id: patientId,
        org_unit_id: orgUnitId3,
        primary_clinician_id: otherActiveStaff,
        is_active: false, // assignment-level inactive
      });
      try {
        const ctx = await buildLiveContext();
        const recipients = await ctx.listEscalationRecipients(
          session.clinicId,
          patientId,
        );
        expect(recipients).not.toContain(otherActiveStaff);
        expect(recipients).toContain(teamLeadStaff); // active assignment still in list
      } finally {
        await dbAdmin('patient_team_assignments').where({ id: ptaId3 }).del();
        await dbAdmin('staff').where({ id: otherActiveStaff }).del();
        await dbAdmin('org_units').where({ id: orgUnitId3 }).del();
      }
    });

    it('TP-PA-INT-578-4: listEscalationRecipients includes clinic admin when nominated', async () => {
      await dbAdmin('clinics')
        .where({ id: session.clinicId })
        .update({ nominated_admin_staff_id: clinicAdminStaff });
      try {
        const ctx = await buildLiveContext();
        const recipients = await ctx.listEscalationRecipients(
          session.clinicId,
          patientId,
        );
        expect(recipients).toContain(teamLeadStaff);
        expect(recipients).toContain(clinicAdminStaff);
      } finally {
        // Don't NULL — restore to whatever beforeAll captured. afterAll
        // does the final restore; intermediate tests just leave the slot
        // populated (subsequent tests that need it cleared explicitly
        // do so in their own setup).
      }
    });
  });
});

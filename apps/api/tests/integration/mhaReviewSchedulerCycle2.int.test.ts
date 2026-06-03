/**
 * BUG-584 + BUG-585 cycle-2 absorb integration test (BUG-451 batch 2).
 *
 * Closes BUG-584-585-FOLLOWUP-INTEGRATION-TEST (S2). Sibling-applicable
 * pattern from BUG-451 batch 1 (pathology cycle-2) — three load-bearing
 * properties documented at file head:
 *
 *   1. Production helper invocation (NOT parallel SQL): invokes the LIVE
 *      production code path via `processMhaReviewAlerts(now,
 *      await buildLiveContext())`. `buildLiveContext` exported from the
 *      scheduler module per the batch-1 template. Mutation tests would
 *      fail if `resolveActiveRecipients` / `writeAuditLogRow` /
 *      `listEscalationRecipients` were reverted.
 *
 *   2. Lowercase audit_log.action filter (case-correct persistence query):
 *      writeAuditLog persists `action` lowercase per audit.ts:347 + v2
 *      `operation` column carries the uppercase literal per audit.ts:340.
 *      Tests filter on `action: 'mha_review_recipient_reassigned'` /
 *      `action: 'mha_review_no_recipient_available'`.
 *
 *   3. Original-value restoration on shared seed-clinic admin slots:
 *      capture `nominated_admin_staff_id` + `delegated_admin_staff_id`
 *      in beforeAll, restore in afterAll (NOT NULL — would pollute
 *      adjacent suites).
 *
 * Skip behavior: degrades to "0 tests run" when integration stack
 * unavailable per `_helpers.ts:isIntegrationReady`.
 *
 * fix-registry anchors: R-FIX-BUG-584-INT-LIVE-RESOLVE +
 * R-FIX-BUG-584-INT-AUDIT-LOG + R-FIX-BUG-585-INT-LIVE-ESCALATION.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-584 + BUG-585 cycle-2 — MHA review scheduler (live)', () => {
  let session: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  let processMhaReviewAlerts: any;
  let buildLiveContext: any;
  let notificationService: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  let origNominatedAdmin: string | null = null;
  let origDelegatedAdmin: string | null = null;

  // Per-suite fixtures (created once; cleaned up FK-safe in afterAll).
  const runId = randomUUID().slice(0, 8);
  const tag = `bug584-585-${runId}`;
  const orgUnitId = randomUUID();
  const patientId = randomUUID();
  const episodeId = randomUUID();
  const ptaId = randomUUID();
  const orderTypeId = randomUUID();
  const narrowOrderTypeId = randomUUID();
  const activeStaff = randomUUID();
  const inactiveStaff = randomUUID();
  const clinicAdminStaff = randomUUID();
  const teamLeadStaff = randomUUID();

  // legal_orders rows created across tests, scoped for FK-safe cleanup.
  const createdOrders: string[] = [];

  beforeAll(async () => {
    if (!ready) return;
    session = await loginAsAdmin();
    ({ dbAdmin } = await import('../../src/db/db'));
    ({ processMhaReviewAlerts, buildLiveContext } = await import(
      '../../src/jobs/schedulers/mhaReviewScheduler'
    ));
    notificationService = (
      await import('../../src/features/notifications/notificationService')
    ).notificationService;

    const clinic = await dbAdmin('clinics')
      .where({ id: session.clinicId })
      .first('nominated_admin_staff_id', 'delegated_admin_staff_id');
    origNominatedAdmin = clinic?.nominated_admin_staff_id ?? null;
    origDelegatedAdmin = clinic?.delegated_admin_staff_id ?? null;

    // legal_order_types is GLOBAL (not clinic-scoped). Insert a fresh
    // type for this suite so production seeded types are not modified.
    await dbAdmin('legal_order_types').insert([
      {
        id: orderTypeId,
        code: `INT-${runId}`,
        name: `Integration Test Order Type ${tag}`,
        jurisdiction: 'VIC',
      },
      {
        id: narrowOrderTypeId,
        code: `INT-NARROW-${runId}`,
        name: `Integration Test Narrow MHA Type ${tag}`,
        jurisdiction: 'VIC',
        max_duration_days: 3,
      },
    ]);

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
        is_active: false, // BUG-584 inactive-recipient path
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
    // Test rows accumulate harmlessly because each run uses fresh
    // record_id UUIDs; subsequent test runs cannot collide. Per
    // CLAUDE.md §11 Layer 4 the integration runner is the audit-trail
    // accumulator by design — test rows are AHPRA-immutable too.
    if (createdOrders.length > 0) {
      await dbAdmin('legal_orders').whereIn('id', createdOrders).del();
    }
    await dbAdmin('episodes').where({ id: episodeId }).del();
    await dbAdmin('patient_team_assignments').where({ patient_id: patientId }).del();
    await dbAdmin('org_units').where({ id: orgUnitId }).del();
    await dbAdmin('patients').where({ id: patientId }).del();
    await dbAdmin('staff')
      .whereIn('id', [activeStaff, inactiveStaff, clinicAdminStaff, teamLeadStaff])
      .del();
    await dbAdmin('legal_order_types')
      .whereIn('id', [orderTypeId, narrowOrderTypeId])
      .del();

    // Restore ORIGINAL admin-slot values per sibling-applicable property #3.
    await dbAdmin('clinics').where({ id: session.clinicId }).update({
      nominated_admin_staff_id: origNominatedAdmin,
      delegated_admin_staff_id: origDelegatedAdmin,
    });
  });

  /**
   * Insert an active legal_order with `review_date` set to NOW
   * (T-0d bucket; immediate review). Tracked in `createdOrders` for
   * FK-safe cleanup.
   */
  async function insertOrder(opts: {
    creatorStaffId: string | null;
    reviewDateOffsetDays?: number;
    reviewDateYmd?: string;
    episodeId?: string;
    orderTypeId?: string;
  }): Promise<string> {
    const id = randomUUID();
    const today = new Date();
    let resolvedReviewYmd = opts.reviewDateYmd;
    if (!resolvedReviewYmd) {
      const reviewDate = new Date(today);
      reviewDate.setDate(today.getDate() + (opts.reviewDateOffsetDays ?? 0));
      resolvedReviewYmd = reviewDate.toISOString().slice(0, 10);
    }
    await dbAdmin('legal_orders').insert({
      id,
      clinic_id: session.clinicId,
      patient_id: patientId,
      episode_id: opts.episodeId ?? episodeId,
      order_type_id: opts.orderTypeId ?? orderTypeId,
      order_number: `MHA-${runId}-${createdOrders.length + 1}`,
      start_date: today,
      review_date: resolvedReviewYmd,
      status: 'active',
      created_by_staff_id: opts.creatorStaffId,
    });
    createdOrders.push(id);
    return id;
  }

  /** Soft-delete the order so subsequent scheduler invocations skip it. */
  async function softDelete(orderId: string): Promise<void> {
    await dbAdmin('legal_orders')
      .where({ id: orderId })
      .update({ deleted_at: new Date() });
  }

  describe('BUG-584 cycle-2 — resolveActiveRecipients (live)', () => {
    it('TP-MHA-INT-584-1: end-to-end via processMhaReviewAlerts — emits to active recipient; no audit row', async () => {
      // Episode primary_clinician = activeStaff; creator = activeStaff →
      // dedupe to single tier-1 recipient.
      const orderId = await insertOrder({ creatorStaffId: activeStaff });

      await dbAdmin('clinics').where({ id: session.clinicId }).update({
        nominated_admin_staff_id: clinicAdminStaff,
        delegated_admin_staff_id: null,
      });

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        const out = await processMhaReviewAlerts(new Date(), ctx);
        expect(out.processed).toBeGreaterThanOrEqual(1);

        const tier1 = emitSpy.mock.calls
          .filter(
            (c) =>
              c[0].payload?.order_id === orderId && c[0].payload?.tier === 1,
          )
          .map((c) => c[0].userId);
        expect(tier1).toContain(activeStaff);
        expect(tier1).not.toContain(clinicAdminStaff);
        expect(tier1).not.toContain(inactiveStaff);

        const audit = await dbAdmin('audit_log')
          .where({ clinic_id: session.clinicId, record_id: orderId })
          .whereIn('action', [
            'mha_review_recipient_reassigned',
            'mha_review_no_recipient_available',
          ])
          .first();
        expect(audit).toBeUndefined();
      } finally {
        emitSpy.mockRestore();
        await softDelete(orderId);
      }
    });

    it('TP-MHA-INT-584-2: BOTH inactive → reassigns to clinic admin; writes mha_review_recipient_reassigned audit row with system_actor metadata', async () => {
      // Episode primary_clinician = inactiveStaff; creator = inactiveStaff
      await dbAdmin('episodes')
        .where({ id: episodeId })
        .update({ primary_clinician_id: inactiveStaff });
      await dbAdmin('clinics')
        .where({ id: session.clinicId })
        .update({ nominated_admin_staff_id: clinicAdminStaff });

      const orderId = await insertOrder({ creatorStaffId: inactiveStaff });
      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processMhaReviewAlerts(new Date(), ctx);

        const tier1 = emitSpy.mock.calls
          .filter(
            (c) =>
              c[0].payload?.order_id === orderId && c[0].payload?.tier === 1,
          )
          .map((c) => c[0].userId);
        expect(tier1).toContain(clinicAdminStaff);
        expect(tier1).not.toContain(inactiveStaff);

        const audit = await dbAdmin('audit_log')
          .where({
            clinic_id: session.clinicId,
            record_id: orderId,
            action: 'mha_review_recipient_reassigned',
          })
          .first('action', 'operation', 'new_data');
        expect(audit).toBeTruthy();
        expect(audit.action).toBe('mha_review_recipient_reassigned');
        expect(audit.operation).toBe('MHA_REVIEW_RECIPIENT_REASSIGNED');

        const nd =
          typeof audit.new_data === 'string'
            ? JSON.parse(audit.new_data)
            : audit.new_data;
        // BUG-584 — system_actor in JSONB metadata SURVIVES the audit.ts
        // UUID-sanitiser (which NULLs `actorId: 'system:mha-review-scheduler'`).
        expect(nd.system_actor).toBe('mha-review-scheduler');
        expect(nd.reason).toBe('both_originals_inactive');
        expect(nd.admin_staff_id).toBe(clinicAdminStaff);
        expect(nd.source_table).toBe('legal_orders');
      } finally {
        emitSpy.mockRestore();
        await softDelete(orderId);
        await dbAdmin('episodes')
          .where({ id: episodeId })
          .update({ primary_clinician_id: activeStaff });
      }
    });

    it('TP-MHA-INT-584-3: FALLTHROUGH — both inactive AND no admin → no tier-1 emit; writes mha_review_no_recipient_available audit row', async () => {
      await dbAdmin('episodes')
        .where({ id: episodeId })
        .update({ primary_clinician_id: inactiveStaff });
      await dbAdmin('clinics').where({ id: session.clinicId }).update({
        nominated_admin_staff_id: null,
        delegated_admin_staff_id: null,
      });

      const orderId = await insertOrder({ creatorStaffId: inactiveStaff });
      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processMhaReviewAlerts(new Date(), ctx);

        const tier1 = emitSpy.mock.calls.filter(
          (c) => c[0].payload?.order_id === orderId && c[0].payload?.tier === 1,
        );
        expect(tier1).toHaveLength(0);

        const audit = await dbAdmin('audit_log')
          .where({
            clinic_id: session.clinicId,
            record_id: orderId,
            action: 'mha_review_no_recipient_available',
          })
          .first('action', 'new_data');
        expect(audit).toBeTruthy();
        const nd =
          typeof audit.new_data === 'string'
            ? JSON.parse(audit.new_data)
            : audit.new_data;
        expect(nd.reason).toBe('no_admin_configured');
        expect(nd.system_actor).toBe('mha-review-scheduler');
        expect(nd.source_table).toBe('legal_orders');
      } finally {
        emitSpy.mockRestore();
        await softDelete(orderId);
        await dbAdmin('episodes')
          .where({ id: episodeId })
          .update({ primary_clinician_id: activeStaff });
      }
    });
  });

  describe('BUG-584 cycle-2 — audit_log persistence (live)', () => {
    it('TP-MHA-INT-584-5: writeAuditLog persists action lowercase + operation uppercase', async () => {
      await dbAdmin('episodes')
        .where({ id: episodeId })
        .update({ primary_clinician_id: inactiveStaff });
      await dbAdmin('clinics')
        .where({ id: session.clinicId })
        .update({ nominated_admin_staff_id: clinicAdminStaff });

      const orderId = await insertOrder({ creatorStaffId: inactiveStaff });
      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processMhaReviewAlerts(new Date(), ctx);

        const lowerHit = await dbAdmin('audit_log')
          .where({
            record_id: orderId,
            action: 'mha_review_recipient_reassigned',
          })
          .first();
        const upperHit = await dbAdmin('audit_log')
          .where({
            record_id: orderId,
            operation: 'MHA_REVIEW_RECIPIENT_REASSIGNED',
          })
          .first();
        expect(lowerHit).toBeTruthy();
        expect(upperHit).toBeTruthy();
        expect(lowerHit.id).toBe(upperHit.id);
      } finally {
        emitSpy.mockRestore();
        await softDelete(orderId);
        await dbAdmin('episodes')
          .where({ id: episodeId })
          .update({ primary_clinician_id: activeStaff });
      }
    });
  });

  describe('BUG-585 cycle-2 — listEscalationRecipients (live)', () => {
    it('TP-MHA-INT-585-1: listEscalationRecipients filters out inactive team-leads (live SQL)', async () => {
      // L3 cycle-1 REJECT absorb: `patient_team_assignments` has UNIQUE
      // (patient_id, org_unit_id) per migration 20260701000000_baseline.ts:1300.
      // beforeAll already inserts (patientId, orgUnitId) — this test's
      // additional PTA MUST use a NEW org_unit (with its own org_units row)
      // or the INSERT throws unique_violation on first execution.
      const ptaId2 = randomUUID();
      const orgUnitId2 = randomUUID();
      await dbAdmin('org_units').insert({
        id: orgUnitId2,
        clinic_id: session.clinicId,
        name: `Unit-585-1 ${tag}`,
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

    it('TP-MHA-INT-585-2: listEscalationRecipients filters out inactive patient_team_assignments rows (live SQL)', async () => {
      // L3 cycle-1 REJECT absorb: per-test org_units row required to
      // avoid PTA unique_violation. See TP-MHA-INT-585-1 absorb note.
      const ptaId3 = randomUUID();
      const orgUnitId3 = randomUUID();
      const otherActiveStaff = randomUUID();
      await dbAdmin('org_units').insert({
        id: orgUnitId3,
        clinic_id: session.clinicId,
        name: `Unit-585-2 ${tag}`,
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
        is_active: false,
      });
      try {
        const ctx = await buildLiveContext();
        const recipients = await ctx.listEscalationRecipients(
          session.clinicId,
          patientId,
        );
        expect(recipients).not.toContain(otherActiveStaff);
        expect(recipients).toContain(teamLeadStaff);
      } finally {
        await dbAdmin('patient_team_assignments').where({ id: ptaId3 }).del();
        await dbAdmin('staff').where({ id: otherActiveStaff }).del();
        await dbAdmin('org_units').where({ id: orgUnitId3 }).del();
      }
    });

    it('TP-MHA-INT-585-3: listEscalationRecipients includes clinic admin when nominated', async () => {
      await dbAdmin('clinics')
        .where({ id: session.clinicId })
        .update({ nominated_admin_staff_id: clinicAdminStaff });
      const ctx = await buildLiveContext();
      const recipients = await ctx.listEscalationRecipients(
        session.clinicId,
        patientId,
      );
      expect(recipients).toContain(teamLeadStaff);
      expect(recipients).toContain(clinicAdminStaff);
    });
  });

  describe('BUG-586 — discharged/soft-deleted episode fallback (live)', () => {
    it('TP-MHA-INT-586-1: legal_order linked to soft-deleted episode falls back to patient current open-episode primary clinician', async () => {
      await dbAdmin('clinics').where({ id: session.clinicId }).update({
        nominated_admin_staff_id: null,
        delegated_admin_staff_id: null,
      });
      await dbAdmin('episodes').where({ id: episodeId }).update({ status: 'open' });

      // Original episode pointer is stale/soft-deleted and has inactive
      // primary clinician; without BUG-586 fallback, tier-1 would
      // silently degrade to creator-only/no-recipient paths.
      const archivedEpisodeId = randomUUID();
      await dbAdmin('episodes').insert({
        id: archivedEpisodeId,
        clinic_id: session.clinicId,
        patient_id: patientId,
        title: `Archived Episode ${tag}`,
        episode_number: `EP-ARCH-${runId}`,
        episode_type: 'inpatient',
        status: 'closed',
        start_date: new Date('2024-01-01T00:00:00.000Z'),
        primary_clinician_id: inactiveStaff,
        deleted_at: new Date(),
      });

      const orderId = await insertOrder({
        creatorStaffId: inactiveStaff,
        reviewDateOffsetDays: 7, // warning bucket; no tier-2 path
        episodeId: archivedEpisodeId,
      });
      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processMhaReviewAlerts(new Date(), ctx);

        const tier1 = emitSpy.mock.calls
          .filter(
            (c) =>
              c[0].payload?.order_id === orderId &&
              c[0].payload?.tier === 1,
          )
          .map((c) => c[0].userId);

        // Current active episode primary clinician is `activeStaff`
        // (seeded in beforeAll). BUG-586 requires this fallback.
        expect(tier1).toContain(activeStaff);
        expect(tier1).not.toContain(inactiveStaff);
      } finally {
        emitSpy.mockRestore();
        await softDelete(orderId);
        await dbAdmin('episodes').where({ id: archivedEpisodeId }).del();
        await dbAdmin('episodes').where({ id: episodeId }).update({ status: 'active' });
      }
    });
  });

  describe('BUG-587 — narrow-window sub-day buckets (live)', () => {
    it('TP-MHA-INT-587-1: narrow-window legal_order due today emits T-12h bucket (not T-0d)', async () => {
      const todayYmd = new Date().toISOString().slice(0, 10);
      const tickNow = new Date(`${todayYmd}T15:30:00.000Z`);
      const orderId = await insertOrder({
        creatorStaffId: activeStaff,
        reviewDateYmd: todayYmd,
        orderTypeId: narrowOrderTypeId,
      });

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: true });
      try {
        const ctx = await buildLiveContext();
        await processMhaReviewAlerts(tickNow, ctx);

        const tier1Calls = emitSpy.mock.calls
          .map((c) => c[0])
          .filter((call) => call.payload?.order_id === orderId && call.payload?.tier === 1);

        expect(tier1Calls.length).toBeGreaterThan(0);
        expect(tier1Calls.every((call) => call.payload?.bucket === 'T-12h')).toBe(true);
      } finally {
        emitSpy.mockRestore();
        await softDelete(orderId);
      }
    });
  });

  describe('BUG-588 — missing review_date data-quality alert (live)', () => {
    it('TP-MHA-INT-588-1: active legal_order with NULL review_date emits bell-only clinic-admin data-quality alert', async () => {
      await dbAdmin('clinics').where({ id: session.clinicId }).update({
        nominated_admin_staff_id: clinicAdminStaff,
        delegated_admin_staff_id: null,
      });

      const orderId = randomUUID();
      await dbAdmin('legal_orders').insert({
        id: orderId,
        clinic_id: session.clinicId,
        patient_id: patientId,
        episode_id: episodeId,
        order_type_id: orderTypeId,
        order_number: `MHA-MISSING-${runId}`,
        start_date: new Date(),
        review_date: null,
        status: 'active',
        created_by_staff_id: activeStaff,
      });
      createdOrders.push(orderId);

      const emitSpy = vi
        .spyOn(notificationService, 'emit')
        .mockResolvedValue({ ids: ['stub'], published: false });
      try {
        const ctx = await buildLiveContext();
        await processMhaReviewAlerts(new Date(), ctx);

        const dqCall = emitSpy.mock.calls.find((c) => c[0].payload?.issue_kind === 'missing_review_date');
        expect(dqCall).toBeTruthy();
        if (!dqCall) throw new Error('expected missing_review_date emit call');

        expect(dqCall[0]).toMatchObject({
          clinicId: session.clinicId,
          userId: clinicAdminStaff,
          severity: 'warning',
          category: 'mha-review',
          channels: ['bell'],
          payload: expect.objectContaining({
            issue_kind: 'missing_review_date',
            source_table: 'legal_orders',
            order_id: orderId,
          }),
        });
        expect(String(dqCall[0].dedupeKey)).toMatch(
          /^mha-review-missing-review-date:legal_orders:/,
        );
      } finally {
        emitSpy.mockRestore();
        await softDelete(orderId);
      }
    });
  });
});

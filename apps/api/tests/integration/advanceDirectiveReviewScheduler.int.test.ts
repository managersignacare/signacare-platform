/**
 * BUG-573 — advance-directive review scheduler live integration coverage.
 *
 * Exercises live query + recipient resolution + emit shape via
 * `processAdvanceDirectiveReviewAlerts(now, await buildLiveContext())`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-573 — advance-directive review scheduler (live)', () => {
  let session: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  let processAdvanceDirectiveReviewAlerts: any;
  let buildLiveContext: any;
  let notificationService: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const runId = randomUUID().slice(0, 8);
  const tag = `bug573-${runId}`;
  const patientId = randomUUID();
  const episodeId = randomUUID();
  const primaryStaffId = randomUUID();
  const adminStaffId = randomUUID();
  const createdDirectiveIds: string[] = [];
  let originalNominatedAdmin: string | null = null;
  let originalDelegatedAdmin: string | null = null;

  beforeAll(async () => {
    if (!READY) return;
    session = await loginAsAdmin();
    ({ dbAdmin } = await import('../../src/db/db'));
    ({ processAdvanceDirectiveReviewAlerts, buildLiveContext } = await import(
      '../../src/jobs/schedulers/advanceDirectiveReviewScheduler'
    ));
    notificationService = (
      await import('../../src/features/notifications/notificationService')
    ).notificationService;

    const clinicRow = await dbAdmin('clinics')
      .where({ id: session.clinicId })
      .first('nominated_admin_staff_id', 'delegated_admin_staff_id');
    originalNominatedAdmin = clinicRow?.nominated_admin_staff_id ?? null;
    originalDelegatedAdmin = clinicRow?.delegated_admin_staff_id ?? null;

    await dbAdmin('staff').insert([
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
        id: adminStaffId,
        clinic_id: session.clinicId,
        email: `admin-${tag}@test.local`,
        given_name: 'Admin',
        family_name: tag,
        password_hash: 'x',
        role: 'admin',
        discipline: 'administration',
        is_active: true,
      },
    ]);

    await dbAdmin('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      emr_number: `${tag}-${runId.slice(0, 4)}`,
      given_name: 'Patient',
      family_name: tag,
      date_of_birth: '1991-01-01',
    });

    await dbAdmin('episodes').insert({
      id: episodeId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      title: `Directive Episode ${tag}`,
      episode_number: `EP-AD-${runId}`,
      episode_type: 'community',
      status: 'open',
      start_date: new Date(),
      primary_clinician_id: primaryStaffId,
    });
  });

  afterAll(async () => {
    if (!READY || !session) return;

    await dbAdmin('clinics').where({ id: session.clinicId }).update({
      nominated_admin_staff_id: originalNominatedAdmin,
      delegated_admin_staff_id: originalDelegatedAdmin,
    });

    if (createdDirectiveIds.length > 0) {
      await dbAdmin('advance_directives').whereIn('id', createdDirectiveIds).del();
    }
    await dbAdmin('episodes').where({ id: episodeId }).del();
    await dbAdmin('patients').where({ id: patientId }).del();
    await dbAdmin('staff').whereIn('id', [primaryStaffId, adminStaffId]).del();
  });

  async function insertDirective(opts: {
    daysFromNow: number;
    status?: 'active' | 'superseded' | 'withdrawn';
  }): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    const due = new Date(now);
    due.setDate(now.getDate() + opts.daysFromNow);
    const validUntil = due.toISOString().slice(0, 10);
    const validFrom = new Date(now.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);

    await dbAdmin('advance_directives').insert({
      id,
      clinic_id: session.clinicId,
      patient_id: patientId,
      type: 'advance_statement',
      content: JSON.stringify({ source: 'integration-bug-573' }),
      status: opts.status ?? 'active',
      valid_from: validFrom,
      valid_until: validUntil,
      created_at: now,
      updated_at: now,
    });
    createdDirectiveIds.push(id);
    return id;
  }

  it('TP-ADR-INT-1: T-30d directive emits warning to current primary clinician', async () => {
    const directiveId = await insertDirective({ daysFromNow: 30 });
    const emitSpy = vi
      .spyOn(notificationService, 'emit')
      .mockResolvedValue({ ids: ['stub'], published: true });
    try {
      const ctx = await buildLiveContext();
      const out = await processAdvanceDirectiveReviewAlerts(new Date(), ctx);
      expect(out.processed).toBeGreaterThanOrEqual(1);

      const calls = emitSpy.mock.calls.filter(
        (c) => c[0].payload?.directive_id === directiveId,
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[0].userId).toBe(primaryStaffId);
      expect(calls[0]?.[0].severity).toBe('warning');
      expect(calls[0]?.[0].payload?.bucket).toBe('T-30d');
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('TP-ADR-INT-2: overdue directive emits critical', async () => {
    const directiveId = await insertDirective({ daysFromNow: -2 });
    const emitSpy = vi
      .spyOn(notificationService, 'emit')
      .mockResolvedValue({ ids: ['stub'], published: true });
    try {
      const ctx = await buildLiveContext();
      await processAdvanceDirectiveReviewAlerts(new Date(), ctx);
      const calls = emitSpy.mock.calls.filter(
        (c) => c[0].payload?.directive_id === directiveId,
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0]?.[0].severity).toBe('critical');
      expect(calls[0]?.[0].payload?.bucket).toBe('T+overdue');
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('TP-ADR-INT-3: non-active directive emits nothing', async () => {
    const directiveId = await insertDirective({ daysFromNow: 30, status: 'superseded' });
    const emitSpy = vi
      .spyOn(notificationService, 'emit')
      .mockResolvedValue({ ids: ['stub'], published: true });
    try {
      const ctx = await buildLiveContext();
      await processAdvanceDirectiveReviewAlerts(new Date(), ctx);
      const calls = emitSpy.mock.calls.filter(
        (c) => c[0].payload?.directive_id === directiveId,
      );
      expect(calls).toHaveLength(0);
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('TP-ADR-INT-4: valid_until outside +30d window emits nothing', async () => {
    const directiveId = await insertDirective({ daysFromNow: 45 });
    const emitSpy = vi
      .spyOn(notificationService, 'emit')
      .mockResolvedValue({ ids: ['stub'], published: true });
    try {
      const ctx = await buildLiveContext();
      await processAdvanceDirectiveReviewAlerts(new Date(), ctx);
      const calls = emitSpy.mock.calls.filter(
        (c) => c[0].payload?.directive_id === directiveId,
      );
      expect(calls).toHaveLength(0);
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('TP-ADR-INT-5: inactive primary clinician reassigns to clinic admin with immutable audit row', async () => {
    const directiveId = await insertDirective({ daysFromNow: 1 });

    await dbAdmin('staff')
      .where({ id: primaryStaffId, clinic_id: session.clinicId })
      .update({ is_active: false, updated_at: new Date() });
    await dbAdmin('clinics')
      .where({ id: session.clinicId })
      .update({ nominated_admin_staff_id: adminStaffId });

    const emitSpy = vi
      .spyOn(notificationService, 'emit')
      .mockResolvedValue({ ids: ['stub'], published: true });
    try {
      const ctx = await buildLiveContext();
      await processAdvanceDirectiveReviewAlerts(new Date(), ctx);

      const calls = emitSpy.mock.calls.filter(
        (c) => c[0].payload?.directive_id === directiveId,
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[0].userId).toBe(adminStaffId);

      const auditRows = await dbAdmin('audit_log')
        .where({
          clinic_id: session.clinicId,
          table_name: 'advance_directives',
          record_id: directiveId,
        })
        .where({ action: 'advance_directive_review_recipient_reassigned' })
        .select('action', 'operation');
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      expect(auditRows[0]?.operation).toBe('ADVANCE_DIRECTIVE_REVIEW_RECIPIENT_REASSIGNED');
    } finally {
      await dbAdmin('staff')
        .where({ id: primaryStaffId, clinic_id: session.clinicId })
        .update({ is_active: true, updated_at: new Date() });
      await dbAdmin('clinics')
        .where({ id: session.clinicId })
        .update({ nominated_admin_staff_id: originalNominatedAdmin });
      emitSpy.mockRestore();
    }
  });
});

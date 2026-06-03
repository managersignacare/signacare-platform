/**
 * BUG-570 — LAI due-alert scheduler live integration coverage.
 *
 * Exercises live query + recipient resolution + emit shape via
 * `processLaiDueAlerts(now, await buildLiveContext())`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-570 — LAI due-alert scheduler (live)', () => {
  let session: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  let processLaiDueAlerts: any;
  let buildLiveContext: any;
  let notificationService: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const runId = randomUUID().slice(0, 8);
  const tag = `bug570-${runId}`;
  const patientId = randomUUID();
  const staleEpisodeId = randomUUID();
  const currentEpisodeId = randomUUID();
  const prescriberStaffId = randomUUID();
  const stalePrimaryStaffId = randomUUID();
  const currentPrimaryStaffId = randomUUID();
  const adminStaffId = randomUUID();
  const createdSchedules: string[] = [];
  let originalNominatedAdmin: string | null = null;
  let originalDelegatedAdmin: string | null = null;

  beforeAll(async () => {
    if (!READY) return;
    session = await loginAsAdmin();
    ({ dbAdmin } = await import('../../src/db/db'));
    ({ processLaiDueAlerts, buildLiveContext } = await import(
      '../../src/jobs/schedulers/laiAlertScheduler'
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
        id: stalePrimaryStaffId,
        clinic_id: session.clinicId,
        email: `stale-primary-${tag}@test.local`,
        given_name: 'StalePrimary',
        family_name: tag,
        password_hash: 'x',
        role: 'doctor',
        discipline: 'psychiatry',
        is_active: true,
      },
      {
        id: currentPrimaryStaffId,
        clinic_id: session.clinicId,
        email: `current-primary-${tag}@test.local`,
        given_name: 'CurrentPrimary',
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

    await dbAdmin('episodes').insert([
      {
        id: staleEpisodeId,
        clinic_id: session.clinicId,
        patient_id: patientId,
        title: `Stale Episode ${tag}`,
        episode_number: `EP-ST-${runId}`,
        episode_type: 'community',
        status: 'closed',
        start_date: new Date(),
        primary_clinician_id: stalePrimaryStaffId,
        deleted_at: new Date(),
      },
      {
        id: currentEpisodeId,
        clinic_id: session.clinicId,
        patient_id: patientId,
        title: `Current Episode ${tag}`,
        episode_number: `EP-CU-${runId}`,
        episode_type: 'community',
        status: 'open',
        start_date: new Date(),
        primary_clinician_id: currentPrimaryStaffId,
      },
    ]);
  });

  afterAll(async () => {
    if (!READY || !session) return;

    await dbAdmin('clinics').where({ id: session.clinicId }).update({
      nominated_admin_staff_id: originalNominatedAdmin,
      delegated_admin_staff_id: originalDelegatedAdmin,
    });

    if (createdSchedules.length > 0) {
      await dbAdmin('lai_schedules').whereIn('id', createdSchedules).del();
    }
    await dbAdmin('episodes').whereIn('id', [staleEpisodeId, currentEpisodeId]).del();
    await dbAdmin('patients').where({ id: patientId }).del();
    await dbAdmin('staff').whereIn('id', [
      prescriberStaffId,
      stalePrimaryStaffId,
      currentPrimaryStaffId,
      adminStaffId,
    ]).del();
  });

  async function insertSchedule(opts: {
    daysFromNow: number;
    softDeleted?: boolean;
    status?: 'active' | 'ceased';
  }): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    const due = new Date(now);
    due.setDate(now.getDate() + opts.daysFromNow);
    const dueYmd = due.toISOString().slice(0, 10);
    const startYmd = new Date(now.getTime() - 35 * 86_400_000).toISOString().slice(0, 10);

    await dbAdmin('lai_schedules').insert({
      id,
      clinic_id: session.clinicId,
      patient_id: patientId,
      episode_id: staleEpisodeId, // forces fallback to current open episode
      prescriber_staff_id: prescriberStaffId,
      drug_name: 'Paliperidone palmitate',
      dose_mg: '150',
      frequency_days: 28,
      injection_site: 'gluteal',
      injection_technique: 'IM',
      loading_dose_required: false,
      loading_doses_required: 0,
      loading_doses_given: 0,
      oral_overlap_required: false,
      start_date: startYmd,
      first_due_date: startYmd,
      next_due_date: dueYmd,
      status: opts.status ?? 'active',
      created_at: now,
      updated_at: now,
      deleted_at: opts.softDeleted ? now : null,
    });
    createdSchedules.push(id);
    return id;
  }

  it('TP-LAI-INT-1: T-7d schedule emits warning to prescriber + current primary clinician fallback', async () => {
    const scheduleId = await insertSchedule({ daysFromNow: 7 });

    const emitSpy = vi
      .spyOn(notificationService, 'emit')
      .mockResolvedValue({ ids: ['stub'], published: true });
    try {
      const ctx = await buildLiveContext();
      const out = await processLaiDueAlerts(new Date(), ctx);
      expect(out.processed).toBeGreaterThanOrEqual(1);

      const calls = emitSpy.mock.calls.filter(
        (c) => c[0].payload?.schedule_id === scheduleId,
      );
      expect(calls).toHaveLength(2);
      const recipients = calls.map((c) => c[0].userId);
      expect(recipients).toContain(prescriberStaffId);
      // fallback via current open episode (stale episode is deleted)
      expect(recipients).toContain(currentPrimaryStaffId);
      expect(calls[0]?.[0].severity).toBe('warning');
      expect(calls[0]?.[0].payload?.bucket).toBe('T-7d');
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('TP-LAI-INT-2: overdue schedule emits critical', async () => {
    const scheduleId = await insertSchedule({ daysFromNow: -2 });
    const emitSpy = vi
      .spyOn(notificationService, 'emit')
      .mockResolvedValue({ ids: ['stub'], published: true });
    try {
      const ctx = await buildLiveContext();
      await processLaiDueAlerts(new Date(), ctx);
      const calls = emitSpy.mock.calls.filter(
        (c) => c[0].payload?.schedule_id === scheduleId,
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0]?.[0].severity).toBe('critical');
      expect(calls[0]?.[0].payload?.bucket).toBe('T+overdue');
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('TP-LAI-INT-3: soft-deleted schedule emits nothing', async () => {
    const scheduleId = await insertSchedule({ daysFromNow: 7, softDeleted: true });
    const emitSpy = vi
      .spyOn(notificationService, 'emit')
      .mockResolvedValue({ ids: ['stub'], published: true });
    try {
      const ctx = await buildLiveContext();
      await processLaiDueAlerts(new Date(), ctx);
      const calls = emitSpy.mock.calls.filter(
        (c) => c[0].payload?.schedule_id === scheduleId,
      );
      expect(calls).toHaveLength(0);
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('TP-LAI-INT-4: next_due_date outside +7d window emits nothing', async () => {
    const scheduleId = await insertSchedule({ daysFromNow: 10 });
    const emitSpy = vi
      .spyOn(notificationService, 'emit')
      .mockResolvedValue({ ids: ['stub'], published: true });
    try {
      const ctx = await buildLiveContext();
      await processLaiDueAlerts(new Date(), ctx);
      const calls = emitSpy.mock.calls.filter(
        (c) => c[0].payload?.schedule_id === scheduleId,
      );
      expect(calls).toHaveLength(0);
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('TP-LAI-INT-5: inactive recipients reassign to clinic admin with immutable audit row', async () => {
    const scheduleId = await insertSchedule({ daysFromNow: 1 });

    await dbAdmin('staff')
      .whereIn('id', [prescriberStaffId, currentPrimaryStaffId])
      .update({ is_active: false, updated_at: new Date() });
    await dbAdmin('clinics')
      .where({ id: session.clinicId })
      .update({ nominated_admin_staff_id: adminStaffId });

    const emitSpy = vi
      .spyOn(notificationService, 'emit')
      .mockResolvedValue({ ids: ['stub'], published: true });
    try {
      const ctx = await buildLiveContext();
      await processLaiDueAlerts(new Date(), ctx);

      const calls = emitSpy.mock.calls.filter(
        (c) => c[0].payload?.schedule_id === scheduleId,
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[0].userId).toBe(adminStaffId);

      const auditRows = await dbAdmin('audit_log')
        .where({ clinic_id: session.clinicId, table_name: 'lai_schedules', record_id: scheduleId })
        .where({ action: 'lai_due_recipient_reassigned' })
        .select('action', 'operation');
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      expect(auditRows[0]?.operation).toBe('LAI_DUE_RECIPIENT_REASSIGNED');
    } finally {
      await dbAdmin('staff')
        .whereIn('id', [prescriberStaffId, currentPrimaryStaffId])
        .update({ is_active: true, updated_at: new Date() });
      await dbAdmin('clinics')
        .where({ id: session.clinicId })
        .update({ nominated_admin_staff_id: originalNominatedAdmin });
      emitSpy.mockRestore();
    }
  });
});

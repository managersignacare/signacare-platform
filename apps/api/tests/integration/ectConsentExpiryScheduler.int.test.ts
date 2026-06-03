/**
 * BUG-572 — ECT consent-expiry scheduler live integration coverage.
 *
 * Exercises live query + per-clinic threshold + recipient resolution +
 * emit shape via `processEctConsentExpiryAlerts(now, await buildLiveContext())`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-572 — ECT consent-expiry scheduler (live)', () => {
  let session: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  let processEctConsentExpiryAlerts: any;
  let buildLiveContext: any;
  let notificationService: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const runId = randomUUID().slice(0, 8);
  const tag = `bug572-${runId}`;
  const validityKey = 'ect_consent_validity_days';
  const thresholdValue = 30;

  const patientId = randomUUID();
  const staleEpisodeId = randomUUID();
  const currentEpisodeId = randomUUID();
  const psychiatristStaffId = randomUUID();
  const stalePrimaryStaffId = randomUUID();
  const currentPrimaryStaffId = randomUUID();
  const adminStaffId = randomUUID();
  const createdCourseIds: string[] = [];

  let originalNominatedAdmin: string | null = null;
  let originalDelegatedAdmin: string | null = null;
  let originalThresholdValue: number | null = null;

  beforeAll(async () => {
    if (!READY) return;
    session = await loginAsAdmin();
    ({ dbAdmin } = await import('../../src/db/db'));
    ({ processEctConsentExpiryAlerts, buildLiveContext } = await import(
      '../../src/jobs/schedulers/ectConsentExpiryScheduler'
    ));
    notificationService = (
      await import('../../src/features/notifications/notificationService')
    ).notificationService;

    const clinicRow = await dbAdmin('clinics')
      .where({ id: session.clinicId })
      .first('nominated_admin_staff_id', 'delegated_admin_staff_id');
    originalNominatedAdmin = clinicRow?.nominated_admin_staff_id ?? null;
    originalDelegatedAdmin = clinicRow?.delegated_admin_staff_id ?? null;

    const thresholdRow = await dbAdmin('clinic_thresholds')
      .where({ clinic_id: session.clinicId, threshold_key: validityKey })
      .first('threshold_value');
    originalThresholdValue = thresholdRow ? Number(thresholdRow.threshold_value) : null;

    await dbAdmin('clinic_thresholds')
      .insert({
        id: randomUUID(),
        clinic_id: session.clinicId,
        threshold_key: validityKey,
        threshold_value: thresholdValue,
        updated_at: new Date(),
      })
      .onConflict(['clinic_id', 'threshold_key'])
      .merge({ threshold_value: thresholdValue, updated_at: new Date() });

    await dbAdmin('staff').insert([
      {
        id: psychiatristStaffId,
        clinic_id: session.clinicId,
        email: `psychiatrist-${tag}@test.local`,
        given_name: 'Psychiatrist',
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

    if (originalThresholdValue == null) {
      await dbAdmin('clinic_thresholds')
        .where({ clinic_id: session.clinicId, threshold_key: validityKey })
        .del();
    } else {
      await dbAdmin('clinic_thresholds')
        .where({ clinic_id: session.clinicId, threshold_key: validityKey })
        .update({ threshold_value: originalThresholdValue, updated_at: new Date() });
    }

    if (createdCourseIds.length > 0) {
      await dbAdmin('ect_courses').whereIn('id', createdCourseIds).del();
    }
    await dbAdmin('episodes').whereIn('id', [staleEpisodeId, currentEpisodeId]).del();
    await dbAdmin('patients').where({ id: patientId }).del();
    await dbAdmin('staff').whereIn('id', [
      psychiatristStaffId,
      stalePrimaryStaffId,
      currentPrimaryStaffId,
      adminStaffId,
    ]).del();
  });

  async function insertCourse(opts: {
    expiryDaysFromNow: number;
    consentObtained?: boolean;
    status?: 'planned' | 'active' | 'completed' | 'discontinued';
    softDeleted?: boolean;
  }): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    const consentDate = new Date(
      now.getTime() + (opts.expiryDaysFromNow - thresholdValue) * 86_400_000,
    );

    await dbAdmin('ect_courses').insert({
      id,
      clinic_id: session.clinicId,
      patient_id: patientId,
      episode_id: staleEpisodeId, // forces fallback to current open episode
      treating_psychiatrist_id: psychiatristStaffId,
      consent_obtained: opts.consentObtained ?? true,
      consent_date: consentDate.toISOString(),
      consent_recorded_by: psychiatristStaffId,
      total_planned_sessions: 12,
      indication: 'Severe treatment-resistant depression',
      status: opts.status ?? 'active',
      notes: `BUG-572 fixture ${tag}`,
      created_at: now,
      updated_at: now,
      deleted_at: opts.softDeleted ? now : null,
    });
    createdCourseIds.push(id);
    return id;
  }

  it('TP-ECT-INT-1: T-7d course emits warning to psychiatrist + current primary clinician fallback', async () => {
    const courseId = await insertCourse({ expiryDaysFromNow: 7 });
    const emitSpy = vi
      .spyOn(notificationService, 'emit')
      .mockResolvedValue({ ids: ['stub'], published: true });
    try {
      const ctx = await buildLiveContext();
      const out = await processEctConsentExpiryAlerts(new Date(), ctx);
      expect(out.processed).toBeGreaterThanOrEqual(1);

      const calls = emitSpy.mock.calls.filter(
        (c) => c[0].payload?.course_id === courseId,
      );
      expect(calls).toHaveLength(2);
      const recipients = calls.map((c) => c[0].userId);
      expect(recipients).toContain(psychiatristStaffId);
      expect(recipients).toContain(currentPrimaryStaffId);
      expect(calls[0]?.[0].severity).toBe('warning');
      expect(calls[0]?.[0].payload?.bucket).toBe('T-7d');
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('TP-ECT-INT-2: overdue course emits critical', async () => {
    const courseId = await insertCourse({ expiryDaysFromNow: -2 });
    const emitSpy = vi
      .spyOn(notificationService, 'emit')
      .mockResolvedValue({ ids: ['stub'], published: true });
    try {
      const ctx = await buildLiveContext();
      await processEctConsentExpiryAlerts(new Date(), ctx);
      const calls = emitSpy.mock.calls.filter(
        (c) => c[0].payload?.course_id === courseId,
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0]?.[0].severity).toBe('critical');
      expect(calls[0]?.[0].payload?.bucket).toBe('T+overdue');
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('TP-ECT-INT-3: consent_obtained=false emits nothing', async () => {
    const courseId = await insertCourse({ expiryDaysFromNow: 7, consentObtained: false });
    const emitSpy = vi
      .spyOn(notificationService, 'emit')
      .mockResolvedValue({ ids: ['stub'], published: true });
    try {
      const ctx = await buildLiveContext();
      await processEctConsentExpiryAlerts(new Date(), ctx);
      const calls = emitSpy.mock.calls.filter(
        (c) => c[0].payload?.course_id === courseId,
      );
      expect(calls).toHaveLength(0);
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('TP-ECT-INT-4: completed course emits nothing', async () => {
    const courseId = await insertCourse({ expiryDaysFromNow: 7, status: 'completed' });
    const emitSpy = vi
      .spyOn(notificationService, 'emit')
      .mockResolvedValue({ ids: ['stub'], published: true });
    try {
      const ctx = await buildLiveContext();
      await processEctConsentExpiryAlerts(new Date(), ctx);
      const calls = emitSpy.mock.calls.filter(
        (c) => c[0].payload?.course_id === courseId,
      );
      expect(calls).toHaveLength(0);
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('TP-ECT-INT-5: inactive recipients reassign to clinic admin with immutable audit row', async () => {
    const courseId = await insertCourse({ expiryDaysFromNow: 1 });

    await dbAdmin('staff')
      .whereIn('id', [psychiatristStaffId, currentPrimaryStaffId])
      .update({ is_active: false, updated_at: new Date() });
    await dbAdmin('clinics')
      .where({ id: session.clinicId })
      .update({ nominated_admin_staff_id: adminStaffId });

    const emitSpy = vi
      .spyOn(notificationService, 'emit')
      .mockResolvedValue({ ids: ['stub'], published: true });
    try {
      const ctx = await buildLiveContext();
      await processEctConsentExpiryAlerts(new Date(), ctx);

      const calls = emitSpy.mock.calls.filter(
        (c) => c[0].payload?.course_id === courseId,
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[0].userId).toBe(adminStaffId);

      const auditRows = await dbAdmin('audit_log')
        .where({
          clinic_id: session.clinicId,
          table_name: 'ect_courses',
          record_id: courseId,
        })
        .where({ action: 'ect_consent_recipient_reassigned' })
        .select('action', 'operation');
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      expect(auditRows[0]?.operation).toBe('ECT_CONSENT_RECIPIENT_REASSIGNED');
    } finally {
      await dbAdmin('staff')
        .whereIn('id', [psychiatristStaffId, currentPrimaryStaffId])
        .update({ is_active: true, updated_at: new Date() });
      await dbAdmin('clinics')
        .where({ id: session.clinicId })
        .update({ nominated_admin_staff_id: originalNominatedAdmin });
      emitSpy.mockRestore();
    }
  });
});

/**
 * BUG-581 — suicidal-ideation after-hours scheduler live integration.
 *
 * Exercises live query + shift-window evaluation + on-call/admin
 * resolution + emit/audit path via
 * `processSuicidalIdeationAfterHoursAlerts(now, await buildLiveContext())`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-581 — suicidal-ideation after-hours scheduler (live)', () => {
  let session: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  let processSuicidalIdeationAfterHoursAlerts: any;
  let buildLiveContext: any;
  let localClockAt: any;
  let notificationService: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const runId = randomUUID().slice(0, 8);
  const tag = `bug581-${runId}`;

  const authorStaffId = randomUUID();
  const onCallStaffId = randomUUID();
  const adminStaffId = randomUUID();
  const patientId = randomUUID();
  const episodeId = randomUUID();

  const createdAvailabilityIds: string[] = [];
  const createdNoteIds: string[] = [];
  const createdRiskIds: string[] = [];
  const createdConsentIds: string[] = [];

  let originalNominatedAdmin: string | null = null;
  let originalDelegatedAdmin: string | null = null;

  beforeAll(async () => {
    if (!READY) return;
    session = await loginAsAdmin();
    ({ dbAdmin } = await import('../../src/db/db'));
    ({
      processSuicidalIdeationAfterHoursAlerts,
      buildLiveContext,
      localClockAt,
    } = await import('../../src/jobs/schedulers/suicidalIdeationAfterHoursScheduler'));
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
        id: authorStaffId,
        clinic_id: session.clinicId,
        email: `author-${tag}@test.local`,
        given_name: 'Author',
        family_name: tag,
        password_hash: 'x',
        role: 'clinician',
        discipline: 'nursing',
        is_active: true,
      },
      {
        id: onCallStaffId,
        clinic_id: session.clinicId,
        email: `oncall-${tag}@test.local`,
        given_name: 'OnCall',
        family_name: tag,
        password_hash: 'x',
        role: 'psychiatrist',
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
      date_of_birth: '1990-01-01',
      created_at: new Date(),
      updated_at: new Date(),
    });

    await dbAdmin('episodes').insert({
      id: episodeId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      episode_type: 'triage',
      title: `Episode ${tag}`,
      status: 'open',
      start_date: new Date(),
      primary_clinician_id: authorStaffId,
      created_at: new Date(),
      updated_at: new Date(),
    });
  });

  afterAll(async () => {
    if (!READY || !session) return;

    await dbAdmin('clinics').where({ id: session.clinicId }).update({
      nominated_admin_staff_id: originalNominatedAdmin,
      delegated_admin_staff_id: originalDelegatedAdmin,
    });

    if (createdAvailabilityIds.length > 0) {
      await dbAdmin('clinician_availability_blocks').whereIn('id', createdAvailabilityIds).del();
    }
    if (createdNoteIds.length > 0) {
      await dbAdmin('clinical_notes').whereIn('id', createdNoteIds).del();
    }
    if (createdConsentIds.length > 0) {
      await dbAdmin('scribe_consents').whereIn('id', createdConsentIds).del();
    }
    if (createdRiskIds.length > 0) {
      await dbAdmin('risk_assessments').whereIn('id', createdRiskIds).del();
    }
    await dbAdmin('episodes').where({ id: episodeId }).del().catch(() => undefined);
    await dbAdmin('patients').where({ id: patientId }).del().catch(() => undefined);
    await dbAdmin('staff').whereIn('id', [authorStaffId, onCallStaffId, adminStaffId]).del().catch(() => undefined);
  });

  async function seedAfterHoursHighRiskNote(now: Date): Promise<string> {
    const noteId = randomUUID();
    const riskId = randomUUID();
    const consentId = randomUUID();
    createdNoteIds.push(noteId);
    createdRiskIds.push(riskId);
    createdConsentIds.push(consentId);

    const riskAt = new Date(now.getTime() - 60 * 1000);

    await dbAdmin('risk_assessments').insert({
      id: riskId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      episode_id: episodeId,
      assessment_type: 'clinical',
      overall_risk_level: 'high',
      suicide_risk: true,
      self_harm_risk: false,
      harm_to_others_risk: false,
      absconding_risk: false,
      vulnerability_risk: true,
      safety_plan_in_place: true,
      assessed_by_id: authorStaffId,
      assessment_date: riskAt.toISOString().slice(0, 10),
      created_at: riskAt,
      updated_at: riskAt,
      lock_version: 1,
    });

    await dbAdmin('scribe_consents').insert({
      id: consentId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      session_id: null,
      mode: 'clinician_attestation',
      patient_signature_png: null,
      clinician_attested_by_id: authorStaffId,
      clinician_attestation_text: 'BUG-581 integration consent fixture',
      attested_at: now,
      created_at: now,
    });

    await dbAdmin('clinical_notes').insert({
      id: noteId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      consent_id: consentId,
      episode_id: episodeId,
      author_id: authorStaffId,
      note_type: 'progress',
      title: `BUG-581 ${tag}`,
      content: 'High suicide-risk note for after-hours routing test.',
      status: 'draft',
      is_draft: true,
      is_signed: false,
      is_reportable_contact: true,
      foi_exempt: false,
      did_not_attend: false,
      is_ai_draft: false,
      lock_version: 1,
      created_at: now,
      updated_at: now,
    });

    return noteId;
  }

  async function setOnCallAvailabilityFor(now: Date): Promise<void> {
    const local = localClockAt(now, 'Australia/Melbourne');
    const blockId = randomUUID();
    createdAvailabilityIds.push(blockId);
    await dbAdmin('clinician_availability_blocks').insert({
      id: blockId,
      clinic_id: session.clinicId,
      clinician_id: onCallStaffId,
      colour: 'green',
      recurrence: 'none',
      specific_date: local.dateYmd,
      day_of_week: null,
      start_time: '00:00:00',
      end_time: '23:59:59',
      effective_from: local.dateYmd,
      effective_until: null,
      label: 'On-call psychiatrist',
      notes: 'BUG-581 integration fixture',
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  it('TP-SI-INT-1: emits to on-call psychiatrist when author is outside shift', async () => {
    const now = new Date();
    const noteId = await seedAfterHoursHighRiskNote(now);
    await setOnCallAvailabilityFor(now);

    const emitSpy = vi
      .spyOn(notificationService, 'emit')
      .mockResolvedValue({ ids: ['stub'], published: true });
    try {
      const ctx = await buildLiveContext();
      const out = await processSuicidalIdeationAfterHoursAlerts(now, ctx);
      expect(out.processed).toBeGreaterThanOrEqual(1);

      const calls = emitSpy.mock.calls.filter(
        (c) => c[0].payload?.note_id === noteId,
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[0].userId).toBe(onCallStaffId);
      expect(calls[0]?.[0].severity).toBe('critical');
      expect(calls[0]?.[0].payload?.overall_risk_level).toBe('high');
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('TP-SI-INT-2: reassigns to clinic admin when no on-call psychiatrist is available', async () => {
    const now = new Date();
    const noteId = await seedAfterHoursHighRiskNote(now);
    await dbAdmin('staff').where({ id: onCallStaffId }).update({ is_active: false, updated_at: new Date() });
    await dbAdmin('clinics')
      .where({ id: session.clinicId })
      .update({ nominated_admin_staff_id: adminStaffId });

    const emitSpy = vi
      .spyOn(notificationService, 'emit')
      .mockResolvedValue({ ids: ['stub'], published: true });
    try {
      const ctx = await buildLiveContext();
      await processSuicidalIdeationAfterHoursAlerts(now, ctx);

      const calls = emitSpy.mock.calls.filter(
        (c) => c[0].payload?.note_id === noteId,
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[0].userId).toBe(adminStaffId);

      const auditRows = await dbAdmin('audit_log')
        .where({ clinic_id: session.clinicId, table_name: 'clinical_notes', record_id: noteId })
        .where({ action: 'si_after_hours_recipient_reassigned' })
        .select('operation');
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      expect(auditRows[0]?.operation).toBe('SI_AFTER_HOURS_RECIPIENT_REASSIGNED');
    } finally {
      await dbAdmin('staff').where({ id: onCallStaffId }).update({ is_active: true, updated_at: new Date() });
      await dbAdmin('clinics')
        .where({ id: session.clinicId })
        .update({ nominated_admin_staff_id: originalNominatedAdmin });
      emitSpy.mockRestore();
    }
  });

  it('TP-SI-INT-3: fail-visible no-recipient path emits no notification and writes immutable audit', async () => {
    const now = new Date();
    const noteId = await seedAfterHoursHighRiskNote(now);
    await dbAdmin('staff').where({ id: onCallStaffId }).update({ is_active: false, updated_at: new Date() });
    await dbAdmin('clinics')
      .where({ id: session.clinicId })
      .update({ nominated_admin_staff_id: null, delegated_admin_staff_id: null });

    const emitSpy = vi
      .spyOn(notificationService, 'emit')
      .mockResolvedValue({ ids: ['stub'], published: true });
    try {
      const ctx = await buildLiveContext();
      await processSuicidalIdeationAfterHoursAlerts(now, ctx);

      const calls = emitSpy.mock.calls.filter(
        (c) => c[0].payload?.note_id === noteId,
      );
      expect(calls).toHaveLength(0);

      const auditRows = await dbAdmin('audit_log')
        .where({ clinic_id: session.clinicId, table_name: 'clinical_notes', record_id: noteId })
        .where({ action: 'si_after_hours_no_recipient_available' })
        .select('operation');
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      expect(auditRows[0]?.operation).toBe('SI_AFTER_HOURS_NO_RECIPIENT_AVAILABLE');
    } finally {
      await dbAdmin('staff').where({ id: onCallStaffId }).update({ is_active: true, updated_at: new Date() });
      await dbAdmin('clinics')
        .where({ id: session.clinicId })
        .update({
          nominated_admin_staff_id: originalNominatedAdmin,
          delegated_admin_staff_id: originalDelegatedAdmin,
        });
      emitSpy.mockRestore();
    }
  });
});

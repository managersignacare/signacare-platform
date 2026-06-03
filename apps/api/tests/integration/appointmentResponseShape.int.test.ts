/**
 * BUG-458 — Appointment service mapper fabricates null/false for 7 real DB
 * columns instead of reading them.
 *
 * Pre-fix `mapDbToResponse()` at apps/api/src/features/appointments/
 * appointmentService.ts:65 hardcodes:
 *   reminderScheduled: false, reminderSent: false, reminderSentAt: null,
 *   rescheduledFromId: null, outlookEventId: null,
 *   telehealthProvider: null, telehealthPasscode: null
 * The columns DO exist in the DB and DO carry the row values — the
 * mapper just discards them. Repository's APPOINTMENT_COLUMNS
 * `.returning(...)` array also strips them on create/update paths.
 *
 * Post-fix: AppointmentDb interface widens to include the 7 fields,
 * APPOINTMENT_COLUMNS array widens, mapper reads real columns, plus
 * `AppointmentResponse.safeParse()` parse-on-emit with
 * `AppError(500, 'RESPONSE_SHAPE_ERROR', { appointmentId, zodIssues })`
 * (BUG-456 absorb-1 + BUG-457 precedent).
 *
 * Pre-fix RED gate:
 *   - AI-1 (defaults): PASS today (mapper hardcodes match DB defaults)
 *   - AI-2 (reminder_sent=true): FAILS today — mapper returns false
 *   - AI-3 (rescheduled_from_id set): FAILS today — mapper returns null
 *   - AI-4 (telehealth provider/passcode/outlook_event_id set): FAILS today
 *   - AI-5 (full Zod parse): PASS today
 *
 * Post-fix: 5/5 GREEN.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { AppointmentResponse } from '@signacare/shared';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

const TEST_LABEL = `BUG-458-${Date.now()}`;
let token = '';
let clinicId = '';
let userId = '';
let patientId = '';
let createdPatientId = '';

const auth = (): { get: (p: string) => request.Test } => ({
  get: (p) =>
    request(app)
      .get(p)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test'),
});

describe.skipIf(!READY)('BUG-458 — Appointment mapper reads real DB columns', () => {
  beforeAll(async () => {
    const sess = await loginAsAdmin();
    token = sess.token;
    clinicId = sess.clinicId;
    userId = sess.userId;

    const p = await dbAdmin('patients')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .select('id')
      .first();
    if (p) {
      patientId = p.id as string;
      return;
    }

    const seededPatientId = randomUUID();
    await dbAdmin('patients').insert({
      id: seededPatientId,
      clinic_id: clinicId,
      given_name: 'Bug458',
      family_name: 'Fixture',
      date_of_birth: '1987-04-15',
      gender: 'female',
      created_at: new Date(),
      updated_at: new Date(),
    } as never);
    patientId = seededPatientId;
    createdPatientId = seededPatientId;
  });

  afterAll(async () => {
    await dbAdmin('appointments')
      .where({ clinic_id: clinicId })
      .where('notes', 'like', `${TEST_LABEL}%`)
      .del();
    if (createdPatientId) {
      await dbAdmin('patients').where({ id: createdPatientId }).del().catch(() => undefined);
    }
  });

  async function seedAppointment(
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    const start = new Date(now.getTime() + 60 * 60_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    await dbAdmin('appointments').insert({
      id,
      clinic_id: clinicId,
      patient_id: patientId,
      clinician_id: userId,
      type: 'initial',
      appointment_type: 'initial',
      start_time: start,
      end_time: end,
      appointment_start: start,
      appointment_end: end,
      status: 'scheduled',
      specialty_code: 'mental_health',
      notes: TEST_LABEL,
      created_at: now,
      updated_at: now,
      ...overrides,
    });
    return id;
  }

  it('AI-1 — appointment with DB defaults round-trips honest defaults', async () => {
    const id = await seedAppointment();
    const res = await auth().get(`/api/v1/appointments/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.reminderScheduled).toBe(false);
    expect(res.body.reminderSent).toBe(false);
    expect(res.body.reminderSentAt).toBeNull();
    expect(res.body.rescheduledFromId).toBeNull();
    expect(res.body.outlookEventId).toBeNull();
    expect(res.body.telehealthProvider).toBeNull();
    expect(res.body.telehealthPasscode).toBeNull();
  });

  it('AI-2 — reminder_sent=true round-trips as reminderSent: true', async () => {
    const sentAt = new Date('2026-04-25T10:00:00.000Z');
    const id = await seedAppointment({
      reminder_scheduled: true,
      reminder_sent: true,
      reminder_sent_at: sentAt,
    });
    const res = await auth().get(`/api/v1/appointments/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.reminderScheduled).toBe(true);
    expect(res.body.reminderSent).toBe(true);
    expect(res.body.reminderSentAt).toBe('2026-04-25T10:00:00.000Z');
  });

  it('AI-3 — rescheduled_from_id round-trips correctly', async () => {
    const originalId = await seedAppointment();
    const newId = await seedAppointment({ rescheduled_from_id: originalId });
    const res = await auth().get(`/api/v1/appointments/${newId}`);
    expect(res.status).toBe(200);
    expect(res.body.rescheduledFromId).toBe(originalId);
  });

  it('AI-4 — telehealth provider/passcode/outlook_event_id round-trip', async () => {
    const id = await seedAppointment({
      telehealth_provider: 'zoom',
      telehealth_passcode: '123456',
      outlook_event_id: 'AAMkAD-test-event-id',
    });
    const res = await auth().get(`/api/v1/appointments/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.telehealthProvider).toBe('zoom');
    expect(res.body.telehealthPasscode).toBe('123456');
    expect(res.body.outlookEventId).toBe('AAMkAD-test-event-id');
  });

  it('AI-6 — list endpoint skips a corrupt row instead of 500ing the whole calendar', async () => {
    // BUG-458 L3 absorb-1 — calendar-blackout resilience. Seed two
    // rows in the same clinician's day window where ONE row has a
    // status the SSoT `AppointmentResponse` enum does not admit
    // (`'arrived_late'`). The DB CHECK on appointments.status is
    // permissive enough to accept arbitrary short strings; the SSoT
    // enum is stricter. Pre-absorb the list endpoint maps via the
    // strict `mapDbToResponse` and 500s on the first bad row,
    // hiding the good row from the clinician.
    // Post-absorb: bad row is skipped + warn-logged; good row ships.
    const goodId = await seedAppointment();
    const badId = randomUUID();
    const now = new Date();
    const start = new Date(now.getTime() + 90 * 60_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    await dbAdmin('appointments').insert({
      id: badId,
      clinic_id: clinicId,
      patient_id: patientId,
      clinician_id: userId,
      type: 'initial',
      appointment_type: 'BUG-458-INVALID-TYPE-NOT-IN-SSOT-ENUM',
      start_time: start,
      end_time: end,
      appointment_start: start,
      appointment_end: end,
      status: 'scheduled',
      specialty_code: 'mental_health',
      notes: TEST_LABEL,
      created_at: now,
      updated_at: now,
    });
    const res = await auth().get(
      `/api/v1/appointments?patientId=${patientId}&limit=200`,
    );
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(goodId);
    expect(ids).not.toContain(badId);
  });

  it('AI-5 — full response satisfies AppointmentResponse SSoT', async () => {
    const id = await seedAppointment({
      reminder_sent: true,
      reminder_sent_at: new Date('2026-04-25T11:00:00.000Z'),
      telehealth_provider: 'teams',
      telehealth_passcode: 'abc',
      outlook_event_id: 'outlook-x',
    });
    const res = await auth().get(`/api/v1/appointments/${id}`);
    expect(res.status).toBe(200);
    const parsed = AppointmentResponse.safeParse(res.body);
    if (!parsed.success) {
      throw new Error(
        `AppointmentResponse parse failed: ${JSON.stringify(parsed.error.issues)}`,
      );
    }
    expect(parsed.success).toBe(true);
  });
});

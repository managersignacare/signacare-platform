import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_TAG = `CAL-VIS-${Date.now().toString(36)}`;

type Session = {
  token: string;
  clinicId: string;
  userId: string;
};

let session: Session;
let patientId = '';
let appointmentId = '';
let primaryClinicianId = '';
let invitedClinicianId = '';
let invitedTeamId = '';
let invitedTeamName = '';
let patientTeamAssignmentId = '';
let primaryTeamAssignmentId = '';
let invitedTeamAssignmentId = '';

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-CSRF-Token': 'test',
    'X-Client': 'mobile',
  };
}

async function withClinicContext<T>(
  clinicId: string,
  work: (trx: Awaited<ReturnType<typeof dbAdmin.transaction>>) => Promise<T>,
): Promise<T> {
  return dbAdmin.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
    return work(trx);
  });
}

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();

  const fixture = await withClinicContext(session.clinicId, async (trx) => {
    const clinicianTemplate = await trx('staff')
      .where({
        clinic_id: session.clinicId,
        role: 'clinician',
        is_active: true,
      })
      .whereNull('deleted_at')
      .first();

    if (!clinicianTemplate) {
      throw new Error(`Calendar visibility integration fixture unavailable: no clinician template found in clinic ${session.clinicId}`);
    }

    const now = new Date().toISOString();
    const teamId = randomUUID();
    const teamName = `${TEST_TAG}-Team`;
    primaryClinicianId = randomUUID();
    invitedClinicianId = randomUUID();
    primaryTeamAssignmentId = randomUUID();
    invitedTeamAssignmentId = randomUUID();

    await trx('org_units').insert({
      id: teamId,
      clinic_id: session.clinicId,
      name: teamName,
      level: '3',
      parent_id: null,
      sort_order: 1,
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    const staffBase = {
      clinic_id: session.clinicId,
      password_hash: clinicianTemplate.password_hash,
      role: 'clinician',
      discipline: clinicianTemplate.discipline ?? null,
      discipline_id: clinicianTemplate.discipline_id ?? null,
      phone_mobile: null,
      phone_work: null,
      ahpra_number: null,
      prescriber_number: null,
      provider_number: null,
      hpii: null,
      qualifications: clinicianTemplate.qualifications ?? null,
      specialisation: clinicianTemplate.specialisation ?? null,
      employment_type: clinicianTemplate.employment_type ?? null,
      worker_type: clinicianTemplate.worker_type ?? null,
      is_active: true,
      require_mfa: false,
      has_mfa_configured: false,
      mfa_enabled: false,
      mfa_secret: null,
      recovery_codes: null,
      must_change_password: false,
      failed_login_attempts: 0,
      locked_until: null,
      last_login_at: null,
      outlook_email: null,
      outlook_refresh_token: null,
      outlook_token_expires_at: null,
      outlook_calendar_id: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      digital_signature: null,
      max_concurrent_sessions: clinicianTemplate.max_concurrent_sessions ?? 5,
    };

    await trx('staff').insert([
      {
        ...staffBase,
        id: primaryClinicianId,
        given_name: 'Calendar',
        family_name: `Primary-${TEST_TAG}`,
        preferred_name: 'Calendar Primary',
        email: `${TEST_TAG}.primary@signacare.local`,
      },
      {
        ...staffBase,
        id: invitedClinicianId,
        given_name: 'Calendar',
        family_name: `Invited-${TEST_TAG}`,
        preferred_name: 'Calendar Invited',
        email: `${TEST_TAG}.invited@signacare.local`,
      },
    ]);

    await trx('staff_team_assignments').insert([
      {
        id: primaryTeamAssignmentId,
        clinic_id: session.clinicId,
        staff_id: primaryClinicianId,
        org_unit_id: teamId,
        start_date: now.slice(0, 10),
        end_date: null,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: invitedTeamAssignmentId,
        clinic_id: session.clinicId,
        staff_id: invitedClinicianId,
        org_unit_id: teamId,
        start_date: now.slice(0, 10),
        end_date: null,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
    ]);

    return {
      primaryClinicianId,
      invitedClinicianId,
      invitedTeamId: teamId,
      invitedTeamName: teamName,
    };
  });

  if (!fixture.primaryClinicianId || !fixture.invitedClinicianId || !fixture.invitedTeamId) {
    throw new Error('Calendar visibility integration fixture unavailable: expected two clinical staff and an active team assignment');
  }

  primaryClinicianId = fixture.primaryClinicianId;
  invitedClinicianId = fixture.invitedClinicianId;
  invitedTeamId = fixture.invitedTeamId;
  invitedTeamName = fixture.invitedTeamName;

  patientId = randomUUID();
  patientTeamAssignmentId = randomUUID();
  appointmentId = randomUUID();

  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 3);
  start.setUTCHours(1, 30, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  await withClinicContext(session.clinicId, async (trx) => {
    await trx('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      given_name: 'Calendar',
      family_name: `Visibility-${TEST_TAG}`,
      emr_number: `${TEST_TAG}-P`,
      date_of_birth: '1990-06-13',
      created_at: new Date(),
      updated_at: new Date(),
    });

    await trx('patient_team_assignments').insert({
      id: patientTeamAssignmentId,
      patient_id: patientId,
      org_unit_id: invitedTeamId,
      primary_clinician_id: primaryClinicianId,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await trx('appointments').insert({
      id: appointmentId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      clinician_id: primaryClinicianId,
      staff_id: primaryClinicianId,
      start_time: start,
      end_time: end,
      appointment_start: start,
      appointment_end: end,
      status: 'scheduled',
      type: 'follow_up',
      appointment_type: 'follow_up',
      mode: 'videoconference',
      telehealth: true,
      telehealth_url: 'https://meet.example.com/shared-session',
      specialty_code: 'mental_health',
      notes: `Calendar visibility ${TEST_TAG}`,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await trx('appointment_attendees').insert([
      {
        id: randomUUID(),
        clinic_id: session.clinicId,
        appointment_id: appointmentId,
        staff_id: primaryClinicianId,
        role: 'primary',
        attendance_status: 'required',
        invited_at: new Date(),
        responded_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: randomUUID(),
        clinic_id: session.clinicId,
        appointment_id: appointmentId,
        staff_id: invitedClinicianId,
        role: 'co_clinician',
        attendance_status: 'required',
        invited_at: new Date(),
        responded_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
  });
});

afterAll(async () => {
  if (!READY) return;
  await withClinicContext(session.clinicId, async (trx) => {
    if (appointmentId) {
      await trx('appointment_attendees').where({ appointment_id: appointmentId }).del().catch(() => undefined);
      await trx('appointments').where({ id: appointmentId }).del().catch(() => undefined);
    }
    if (patientTeamAssignmentId) {
      await trx('patient_team_assignments').where({ id: patientTeamAssignmentId }).del().catch(() => undefined);
    }
    if (patientId) {
      await trx('patients').where({ id: patientId }).del().catch(() => undefined);
    }
    if (primaryTeamAssignmentId || invitedTeamAssignmentId) {
      await trx('staff_team_assignments')
        .whereIn('id', [primaryTeamAssignmentId, invitedTeamAssignmentId].filter(Boolean))
        .del()
        .catch(() => undefined);
    }
    if (primaryClinicianId || invitedClinicianId) {
      await trx('staff')
        .whereIn('id', [primaryClinicianId, invitedClinicianId].filter(Boolean))
        .del()
        .catch(() => undefined);
    }
    if (invitedTeamId) {
      await trx('org_units').where({ id: invitedTeamId }).del().catch(() => undefined);
    }
  });
});

describe.skipIf(!READY)('calendar visibility for shared appointments', () => {
  it('lists invited-clinician appointments with team and attendee metadata', async () => {
    const res = await request(app)
      .get(`/api/v1/appointments?clinicianId=${invitedClinicianId}&from=2020-01-01T00:00:00.000Z&to=2040-01-01T00:00:00.000Z&limit=100`)
      .set(authHeaders(session.token));

    expect(res.status).toBe(200);
    const appointment = (res.body as Array<Record<string, unknown>>).find((row) => row.id === appointmentId);
    expect(appointment).toBeTruthy();
    expect(appointment?.['mode']).toBe('videoconference');
    expect(appointment?.['teamId']).toBe(invitedTeamId);
    expect(appointment?.['teamName']).toBe(invitedTeamName);
    expect(appointment?.['attendeeStaffIds']).toEqual(
      expect.arrayContaining([primaryClinicianId, invitedClinicianId]),
    );
    expect(appointment?.['attendeeStaffNames']).toBeInstanceOf(Array);
  });

  it('shows shared appointments in the invited clinician today-view calendar', async () => {
    const start = new Date(await withClinicContext(session.clinicId, async (trx) => {
      const row = await trx('appointments').where({ id: appointmentId }).first('appointment_start');
      return String(row?.appointment_start);
    }));
    const day = start.toISOString().slice(0, 10);

    const res = await request(app)
      .get(`/api/v1/calendar/today?clinicianId=${invitedClinicianId}&date=${day}`)
      .set(authHeaders(session.token));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.appointments)).toBe(true);
    expect(res.body.appointments.some((row: { id: string }) => row.id === appointmentId)).toBe(true);
  });
});

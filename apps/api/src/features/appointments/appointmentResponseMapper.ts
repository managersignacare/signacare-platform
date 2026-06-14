import { db } from '../../db/db';
import { AppointmentResponse } from '@signacare/shared';
import { AppError } from '../../shared/errors';
import { logger } from '../../utils/logger';
import type { AppointmentStatus } from './appointmentRepository';
import type { ZodIssue } from 'zod';
import { hasOptionalTable } from '../../shared/optionalSchema';

type AppointmentResponseType = typeof AppointmentResponse._type;

function asIsoDateTime(
  value: unknown,
  fieldName: string,
  appointmentId: unknown,
): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  throw new AppError(
    `Appointment response missing valid ${fieldName}`,
    500,
    'RESPONSE_SHAPE_ERROR',
    { appointmentId, fieldName, valueType: typeof value },
  );
}

export function mapDbToResponse(row: Record<string, unknown>): AppointmentResponseType {
  const reminderSentAt = row.reminder_sent_at as Date | null;
  const start = row.appointment_start ?? row.start_time;
  const end = row.appointment_end ?? row.end_time;
  const type = (row.appointment_type ?? row.type) as AppointmentResponseType['type'] | undefined;
  const candidate = {
    id: row.id as string,
    clinicId: row.clinic_id as string,
    patientId: row.patient_id as string,
    clinicianId: row.clinician_id as string,
    episodeId: (row.episode_id as string | null) ?? null,
    specialtyCode: (row.specialty_code as AppointmentResponseType['specialtyCode']) ?? null,
    startTime: asIsoDateTime(start, 'start_time', row.id),
    endTime: asIsoDateTime(end, 'end_time', row.id),
    status: row.status as AppointmentStatus,
    type,
    mode: (row.mode as AppointmentResponseType['mode'] | null | undefined) ?? null,
    patientResponse: (row.patient_response as 'attending' | 'not_attending' | null | undefined) ?? null,
    notes: (row.notes as string | null) ?? null,
    teamId: (row.team_id as string | null | undefined) ?? null,
    teamName: (row.team_name as string | null | undefined) ?? null,
    attendeeStaffIds: Array.isArray(row.attendee_staff_ids)
      ? (row.attendee_staff_ids as string[])
      : [],
    attendeeStaffNames: Array.isArray(row.attendee_staff_names)
      ? (row.attendee_staff_names as string[])
      : [],
    telehealthLink: (row.telehealth_url as string | null) ?? null,
    telehealthProvider: (row.telehealth_provider as string | null) ?? null,
    telehealthPasscode: (row.telehealth_passcode as string | null) ?? null,
    cancellationReason: (row.cancellation_reason as string | null) ?? null,
    rescheduledFromId: (row.rescheduled_from_id as string | null) ?? null,
    reminderScheduled: Boolean(row.reminder_scheduled),
    reminderSent: Boolean(row.reminder_sent),
    reminderSentAt: reminderSentAt ? reminderSentAt.toISOString() : null,
    outlookEventId: (row.outlook_event_id as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
  const parsed = AppointmentResponse.safeParse(candidate);
  if (!parsed.success) {
    const issues: ZodIssue[] = parsed.error.issues;
    throw new AppError(
      'Appointment response shape failed schema validation',
      500,
      'RESPONSE_SHAPE_ERROR',
      { appointmentId: row.id, zodIssues: issues },
    );
  }
  return parsed.data;
}

export function toResponseListSafe(
  rows: Array<Record<string, unknown>>,
  clinicId: string,
): AppointmentResponseType[] {
  const out: AppointmentResponseType[] = [];
  for (const r of rows) {
    try {
      out.push(mapDbToResponse(r));
    } catch (err) {
      logger.warn(
        {
          appointmentId: r.id as string | undefined,
          clinicId,
          err: err instanceof Error ? err.message : String(err),
          kind: 'appointment_response_shape_skip',
        },
        'BUG-458: appointment row failed shape validation, skipped from list response',
      );
    }
  }
  return out;
}

interface AppointmentTeamDecoratedRow {
  appointment_id: string;
  patient_id: string;
  team_id: string | null;
  team_name: string | null;
}

interface PatientTeamDecoratedRow {
  patient_id: string;
  org_unit_id: string | null;
  org_unit_name: string | null;
}

interface AppointmentAttendeeDecoratedRow {
  appointment_id: string;
  staff_id: string;
  given_name: string | null;
  family_name: string | null;
}

export async function enrichAppointmentRows(
  clinicId: string,
  rows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  if (rows.length === 0) return rows;

  const appointmentIds = rows
    .map((row) => (typeof row.id === 'string' ? row.id : null))
    .filter((id): id is string => id !== null);
  const patientIds = rows
    .map((row) => (typeof row.patient_id === 'string' ? row.patient_id : null))
    .filter((id): id is string => id !== null);

  const attendeeTableAvailable = await hasOptionalTable('appointment_attendees');

  const [teamRows, patientTeamRows, attendeeRows] = await Promise.all([
    db('appointments as a')
      .leftJoin('episodes as e', 'e.id', 'a.episode_id')
      // @fk-join-exempt: optional episode-backed team decoration joins the parent org unit after resolving the episode row.
      .leftJoin('org_units as ou', 'ou.id', 'e.team_id')
      .where('a.clinic_id', clinicId)
      .whereIn('a.id', appointmentIds)
      .select({
        appointment_id: 'a.id',
        patient_id: 'a.patient_id',
        team_id: 'e.team_id',
        team_name: 'ou.name',
      }) as Promise<AppointmentTeamDecoratedRow[]>,
    db('patient_team_assignments as pta')
      .join('patients as p', 'p.id', 'pta.patient_id')
      .leftJoin('org_units as ou', 'ou.id', 'pta.org_unit_id')
      .where('p.clinic_id', clinicId)
      .whereNull('p.deleted_at')
      .whereIn('pta.patient_id', patientIds)
      .where('pta.is_active', true)
      .orderBy([
        { column: 'pta.updated_at', order: 'desc' },
        { column: 'pta.created_at', order: 'desc' },
      ])
      .select({
        patient_id: 'pta.patient_id',
        org_unit_id: 'pta.org_unit_id',
        org_unit_name: 'ou.name',
      }) as Promise<PatientTeamDecoratedRow[]>,
    attendeeTableAvailable
      ? (db('appointment_attendees as aa')
        .leftJoin('staff as s', 's.id', 'aa.staff_id')
        .where('aa.clinic_id', clinicId)
        .whereIn('aa.appointment_id', appointmentIds)
        .whereNot('aa.attendance_status', 'removed')
        .orderBy('aa.invited_at', 'asc')
        .select({
          appointment_id: 'aa.appointment_id',
          staff_id: 'aa.staff_id',
          given_name: 's.given_name',
          family_name: 's.family_name',
        }) as Promise<AppointmentAttendeeDecoratedRow[]>)
      : Promise.resolve([] as AppointmentAttendeeDecoratedRow[]),
  ]);

  const teamByAppointment = new Map(
    teamRows.map((row) => [row.appointment_id, row] as const),
  );
  const patientTeamByPatient = new Map<string, PatientTeamDecoratedRow>();
  for (const row of patientTeamRows) {
    if (!patientTeamByPatient.has(row.patient_id)) {
      patientTeamByPatient.set(row.patient_id, row);
    }
  }

  const attendeesByAppointment = new Map<string, { ids: string[]; names: string[] }>();
  for (const row of attendeeRows) {
    const bucket = attendeesByAppointment.get(row.appointment_id) ?? { ids: [], names: [] };
    bucket.ids.push(row.staff_id);
    const name = `${row.given_name ?? ''} ${row.family_name ?? ''}`.trim();
    bucket.names.push(name || row.staff_id);
    attendeesByAppointment.set(row.appointment_id, bucket);
  }

  return rows.map((row) => {
    const appointmentId = row.id as string;
    const patientId = row.patient_id as string;
    const explicitTeam = teamByAppointment.get(appointmentId);
    const fallbackTeam = patientTeamByPatient.get(patientId);
    const attendees = attendeesByAppointment.get(appointmentId) ?? { ids: [], names: [] };

    return {
      ...row,
      team_id: explicitTeam?.team_id ?? fallbackTeam?.org_unit_id ?? null,
      team_name: explicitTeam?.team_name ?? fallbackTeam?.org_unit_name ?? null,
      attendee_staff_ids: attendees.ids,
      attendee_staff_names: attendees.names,
    };
  });
}

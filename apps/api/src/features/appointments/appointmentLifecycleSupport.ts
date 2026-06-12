// @jsonb-extraction-exempt: support-layer booking notifications and calendar sync read staff for internal routing only; this module does not shape API response DTOs.
import { db } from '../../db/db';
import { settingsService } from '../settings/settingsService';
import { jobBus } from '../../shared/jobBus';
import { emitClinicalSignal } from '../events/clinicalSignalEmitter';
import { AppError } from '../../shared/errors';
import { logger } from '../../utils/logger';
import { outlookCalendarSyncService } from '../../integrations/outlook/outlookCalendarSyncService';

const DEFAULT_BOOKING_MAX_ADVANCE_DAYS = 183;
const DEFAULT_BOOKING_OPEN_HOUR_LOCAL = 6;
const DEFAULT_BOOKING_CLOSE_HOUR_LOCAL = 22;

function localHourInTimeZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hourPart = parts.find((p) => p.type === 'hour')?.value;
  const parsed = Number(hourPart);
  return Number.isInteger(parsed) ? parsed : 0;
}

export async function assertBookingGuardrails(
  clinicId: string,
  start: Date,
  end: Date,
): Promise<void> {
  const thresholds = await settingsService.getThresholds(clinicId);
  const maxAdvanceDays = Number(
    thresholds['appointment_max_advance_days'] ?? DEFAULT_BOOKING_MAX_ADVANCE_DAYS,
  );
  const openHour = Number(
    thresholds['appointment_open_hour_local'] ?? DEFAULT_BOOKING_OPEN_HOUR_LOCAL,
  );
  const closeHour = Number(
    thresholds['appointment_close_hour_local'] ?? DEFAULT_BOOKING_CLOSE_HOUR_LOCAL,
  );

  const maxStart = new Date();
  maxStart.setDate(maxStart.getDate() + maxAdvanceDays);
  if (start.getTime() > maxStart.getTime()) {
    throw new AppError(
      `Appointment start exceeds clinic booking window (${maxAdvanceDays} days).`,
      422,
      'BOOKING_ADVANCE_WINDOW_EXCEEDED',
      { maxAdvanceDays },
    );
  }

  const clinic = await db('clinics')
    .where({ id: clinicId })
    .whereNull('deleted_at')
    .first('time_zone', 'timezone');
  const timeZone = String(clinic?.time_zone ?? clinic?.timezone ?? 'Australia/Melbourne');
  const startHour = localHourInTimeZone(start, timeZone);
  const endHour = localHourInTimeZone(end, timeZone);

  if (startHour < openHour || startHour >= closeHour) {
    throw new AppError(
      `Appointment start must be within clinic operating hours (${openHour}:00-${closeHour}:00 ${timeZone}).`,
      422,
      'BOOKING_OUTSIDE_CLINIC_HOURS',
      { timeZone, openHour, closeHour, startHour },
    );
  }

  if (endHour < openHour || endHour > closeHour) {
    throw new AppError(
      `Appointment end must be within clinic operating hours (${openHour}:00-${closeHour}:00 ${timeZone}).`,
      422,
      'BOOKING_OUTSIDE_CLINIC_HOURS',
      { timeZone, openHour, closeHour, endHour },
    );
  }
}

export async function clearQueuedAppointmentReminders(
  clinicId: string,
  appointmentId: string,
): Promise<{ emailRemoved: number; outreachRemoved: number }> {
  const [emailRemoved, outreachRemoved] = await Promise.all([
    jobBus.removeByMatch('email', {
      type: 'appointment_reminder',
      clinicId,
      appointmentId,
    }),
    jobBus.removeByMatch('patient-outreach', {
      kind: 'appointment_reminder',
      clinicId,
      appointmentId,
    }),
  ]);
  return { emailRemoved, outreachRemoved };
}

async function readPatientDisplayName(clinicId: string, patientId: string): Promise<string> {
  const patient = await db('patients')
    .where({ clinic_id: clinicId, id: patientId })
    .whereNull('deleted_at')
    .first('given_name', 'family_name');
  if (!patient) return 'Patient';
  const given = String(patient['given_name'] ?? '').trim();
  const family = String(patient['family_name'] ?? '').trim();
  const full = `${given} ${family}`.trim();
  return full.length > 0 ? full : 'Patient';
}

export async function emitAppointmentBookedNotification(input: {
  clinicId: string;
  appointmentId: string;
  createdByStaffId: string;
  clinicianId: string;
  patientId: string;
  startTimeIso: string;
}): Promise<void> {
  if (input.createdByStaffId === input.clinicianId) return;
  try {
    const patientName = await readPatientDisplayName(input.clinicId, input.patientId);
    const start = new Date(input.startTimeIso);
    const startLabel = `${start.toLocaleDateString('en-AU')} ${start.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`;

    await emitClinicalSignal({
      source: 'appointments',
      signalKey: 'appointment-booked',
      clinicId: input.clinicId,
      userId: input.clinicianId,
      severity: 'info',
      category: 'appointment',
      title: 'New appointment booked',
      body: `${patientName} — ${startLabel}`,
      actionUrl: input.patientId ? `/patients/${input.patientId}` : '/appointments',
      payload: {
        appointment_id: input.appointmentId,
        patient_id: input.patientId,
        start_time: input.startTimeIso,
        created_by_staff_id: input.createdByStaffId,
      },
      dedupeKey: `appointment-booked:${input.appointmentId}:${input.clinicianId}`,
      sseEventType: 'appointment-booked',
    });
  } catch (err) {
    logger.warn(
      {
        err,
        clinicId: input.clinicId,
        appointmentId: input.appointmentId,
        clinicianId: input.clinicianId,
      },
      'Failed to emit appointment-booked notification',
    );
  }
}

function appointmentTypeLabel(type: string): string {
  switch (type) {
    case 'initial': return 'Initial assessment';
    case 'follow_up': return 'Follow-up';
    case 'assessment': return 'Assessment';
    case 'telehealth': return 'Telehealth';
    case 'group': return 'Group session';
    case 'clinical_review': return 'Clinical review';
    default: return type;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function clinicianHasConnectedOutlookCalendar(
  clinicId: string,
  clinicianId: string,
): Promise<boolean> {
  const row = await db('staff')
    .where({ clinic_id: clinicId, id: clinicianId })
    .whereNull('deleted_at')
    .first('outlook_refresh_token');
  return Boolean(row?.outlook_refresh_token);
}

async function resolveStaffCalendarEmails(
  clinicId: string,
  staffIds: string[],
): Promise<string[]> {
  if (staffIds.length === 0) return [];
  const rows = await db('staff')
    .where({ clinic_id: clinicId })
    .whereNull('deleted_at')
    .whereIn('id', staffIds)
    .select('email', 'outlook_email');
  const emails = rows
    .map((row) => String(row['outlook_email'] ?? row['email'] ?? '').trim())
    .filter((email) => email.length > 0);
  return Array.from(new Set(emails));
}

export async function enqueueAppointmentCalendarSync(input: {
  clinicId: string;
  appointmentId: string;
  clinicianId: string;
  patientId: string;
  appointmentType: string;
  mode: 'direct' | 'telehealth' | 'videoconference' | 'other';
  startTimeIso: string;
  endTimeIso: string;
  notes?: string | null;
  attendeeStaffIds?: string[];
  type: 'create' | 'update' | 'delete';
}): Promise<void> {
  const connected = await clinicianHasConnectedOutlookCalendar(
    input.clinicId,
    input.clinicianId,
  );
  if (!connected) return;

  try {
    await outlookCalendarSyncService.ensureSubscriptionForStaff({
      clinicId: input.clinicId,
      ownerStaffId: input.clinicianId,
    });
  } catch (error) {
    logger.warn(
      {
        err: error,
        clinicId: input.clinicId,
        clinicianId: input.clinicianId,
        appointmentId: input.appointmentId,
      },
      'Failed to ensure Outlook calendar subscription before appointment sync',
    );
  }

  const patientName = await readPatientDisplayName(input.clinicId, input.patientId);
  const subject = `${appointmentTypeLabel(input.appointmentType)} — ${patientName}`;

  if (input.type === 'delete') {
    await db('appointments')
      .where({ clinic_id: input.clinicId, id: input.appointmentId })
      .whereNull('deleted_at')
      .update({
        outlook_last_synced_at: new Date(),
        outlook_sync_status: 'pending_delete',
        outlook_sync_error: null,
        updated_at: new Date(),
      })
      .catch((error) => {
        logger.warn(
          { err: error, clinicId: input.clinicId, appointmentId: input.appointmentId },
          'Failed to mark appointment as pending Outlook delete before enqueue',
        );
      });
    await jobBus.enqueue(
      'outlook',
      {
        clinicId: input.clinicId,
        clinicianId: input.clinicianId,
        appointmentId: input.appointmentId,
        type: 'delete',
      },
      { jobId: `outlook:delete:${input.appointmentId}` },
    );
    return;
  }

  const attendeeEmails = await resolveStaffCalendarEmails(
    input.clinicId,
    (input.attendeeStaffIds ?? []).filter((id) => id !== input.clinicianId),
  );
  const htmlBody = [
    `<p><strong>${escapeHtml(subject)}</strong></p>`,
    input.notes ? `<p>${escapeHtml(String(input.notes)).replace(/\n/g, '<br/>')}</p>` : '',
  ].filter(Boolean).join('');

  await db('appointments')
    .where({ clinic_id: input.clinicId, id: input.appointmentId })
    .whereNull('deleted_at')
    .update({
      outlook_last_synced_at: new Date(),
      outlook_sync_status: input.type === 'create' ? 'pending_create' : 'pending_update',
      outlook_sync_error: null,
      updated_at: new Date(),
    })
    .catch((error) => {
      logger.warn(
        { err: error, clinicId: input.clinicId, appointmentId: input.appointmentId, type: input.type },
        'Failed to mark appointment as pending Outlook sync before enqueue',
      );
    });

  await jobBus.enqueue(
    'outlook',
    {
      clinicId: input.clinicId,
      clinicianId: input.clinicianId,
      appointmentId: input.appointmentId,
      type: input.type,
      payload: {
        subject,
        htmlBody,
        startIso: input.startTimeIso,
        endIso: input.endTimeIso,
        attendeeEmails,
        isTeamsMeeting: input.mode === 'videoconference',
      },
    },
    {
      jobId: `${input.type === 'create' ? 'outlook:create' : 'outlook:update'}:${input.appointmentId}:${input.startTimeIso}:${input.endTimeIso}`,
    },
  );
}

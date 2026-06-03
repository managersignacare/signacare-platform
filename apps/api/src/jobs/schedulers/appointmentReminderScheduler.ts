// apps/api/src/jobs/schedulers/appointmentReminderScheduler.ts
//
// BUG-583 (2026-04-26) — switched bare `db()` → `dbAdmin` for tenant-table
// reads + writes. The proxy in `apps/api/src/db/db.ts:168` falls back to
// `appPool` (app_user role) outside any request, and the RLS policy
// `clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid`
// evaluates `clinic_id = NULL` → all rows excluded. The scheduler was
// silently emitting zero appointment reminders in production. `dbAdmin`
// uses the signacare_owner role which bypasses RLS by ownership.
// Tenant scoping is preserved by every row carrying its FK-bound
// `clinic_id` into downstream `addJob` calls.
import { dbAdmin } from '../../db/db';
import { settingsService } from '../../features/settings/settingsService';
import { addJob } from '../../queues';
import { runScheduledTick } from './runScheduledTick';

interface AppointmentReminderTickResult {
  processedAppointments: number;
}

function appointmentReminderJobId(input: {
  queue: 'email' | 'patient-outreach';
  appointmentId: string;
  offsetMs: number;
  sendAtIso: string;
}): string {
  const normalizedSendAt = input.sendAtIso.replace(/[^\dTZ]/g, '');
  return [
    'appt-reminder',
    input.queue,
    input.appointmentId,
    `offset-${input.offsetMs}`,
    normalizedSendAt,
  ].join(':');
}

export async function processAppointmentReminders(
  now: Date = new Date(),
): Promise<AppointmentReminderTickResult> {
  const nowIso = now.toISOString();
  // Look ahead max 8 days (covers all threshold combinations)
  const lookAhead = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000).toISOString();

  const appointments = await dbAdmin('appointments')
    .whereNull('deleted_at')
    .whereIn('status', ['scheduled', 'confirmed', 'arrived'])
    .where((qb) => {
      qb.where('reminder_scheduled', false).orWhereNull('reminder_scheduled');
    })
    .where('start_time', '>', nowIso)
    .where('start_time', '<', lookAhead)
    .select('id', 'clinic_id', 'patient_id', 'start_time', 'reminder_scheduled', 'reminder_sent');

  for (const appt of appointments) {
    const startTime = new Date(appt.start_time as string);
    // BUG-592-FOLLOWUP-DBADMIN-THRESHOLDS — pass `dbAdmin` so the
    // RLS-bound `clinic_thresholds` lookup does not silent-zero in
    // cron context (no `app.clinic_id` GUC outside Express).
    const thresholds = await settingsService.getThresholds(
      appt.clinic_id as string,
      dbAdmin,
    );
    const weekDays = (thresholds['appointment_reminder_week_days'] as number) ?? 7;
    const days = (thresholds['appointment_reminder_days'] as number) ?? 1;
    const hours = (thresholds['appointment_reminder_hours'] as number) ?? 2;

    const offsets = [
      weekDays * 24 * 60 * 60 * 1000,
      days * 24 * 60 * 60 * 1000,
      hours * 60 * 60 * 1000,
    ];

    for (const offset of offsets) {
      const sendAt = new Date(startTime.getTime() - offset);
      if (sendAt <= now) continue;

      const delay = sendAt.getTime() - now.getTime();

      await addJob('email', {
        type: 'appointment_reminder',
        clinicId: appt.clinic_id,
        patientId: appt.patient_id,
        appointmentId: appt.id,
        scheduledFor: sendAt.toISOString(),
        channel: 'email',
      }, {
        delay,
        jobId: appointmentReminderJobId({
          queue: 'email',
          appointmentId: String(appt.id),
          offsetMs: offset,
          sendAtIso: sendAt.toISOString(),
        }),
      });

      // Phase 10F — route patient-destined outreach through the
      // 'patient-outreach' dispatcher queue. The Phase 12
      // patientOutreachWorker picks the right channel (FCM if
      // patient has Viva installed, ACS SMS if they've consented
      // and have a mobile number, audit-logged skip otherwise).
      // The raw 'sms' queue name is now forbidden by the
      // jobBus allowlist.
      //
      // The dedupeKey — `appt-reminder:${appt.id}:${offset}` —
      // makes this scheduler idempotent under the every-15-min
      // cron: the partial unique index on
      // (clinic_id, payload->>'dedupe_key') rejects duplicate
      // dispatcher entries when Phase 12B writes them as
      // notification rows downstream.
      await addJob('patient-outreach', {
        kind: 'appointment_reminder',
        clinicId: appt.clinic_id,
        patientId: appt.patient_id,
        appointmentId: appt.id,
        scheduledFor: sendAt.toISOString(),
        dedupeKey: `appt-reminder:${appt.id as string}:offset:${offset}`,
      }, {
        delay,
        jobId: appointmentReminderJobId({
          queue: 'patient-outreach',
          appointmentId: String(appt.id),
          offsetMs: offset,
          sendAtIso: sendAt.toISOString(),
        }),
      });
    }

    await dbAdmin('appointments')
      .where({ id: appt.id, clinic_id: appt.clinic_id })
      .update({ reminder_scheduled: true, updated_at: new Date() });
  }

  return { processedAppointments: appointments.length };
}

const appointmentReminderTask = runScheduledTick<AppointmentReminderTickResult>({
  schedulerName: 'appointment-reminder',
  cronExpression: '*/15 * * * *',
  dbAccess: 'dbAdmin',
  startMessage: 'Running appointment reminder scheduler',
  successMessage: 'Appointment reminder scheduler processed appointments',
  errorMessage: 'Appointment reminder scheduler failed',
  tick: processAppointmentReminders,
  successMeta: (result) => ({ count: result.processedAppointments }),
  zeroRow: {
    isZero: (result) => result.processedAppointments === 0,
    kind: 'APPOINTMENT_REMINDER_ZERO_ROWS',
    message: 'Appointment reminder scheduler found no due reminders in look-ahead window',
  },
});

export { appointmentReminderTask };

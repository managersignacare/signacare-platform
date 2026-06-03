import { dbAdmin } from '../../db/db';
import { withTenantContext } from '../../shared/tenantContext';
import { logger } from '../../utils/logger';
import { patientOutreachService, type ForceChannel, type OutreachKind } from './patientOutreachService';

export interface OutreachJobData {
  clinicId: string;
  patientId: string;
  kind: OutreachKind;
  title?: string;
  body?: string;
  deepLink?: string;
  forceChannel?: ForceChannel;
  overrideReason?: string;
  overrideByStaffId?: string;
  appointmentId?: string;
  scheduledFor?: string;
  dedupeKey?: string;
}

function defaultOutreachCopy(data: OutreachJobData): { title: string; body: string } {
  if (data.kind === 'appointment_reminder') {
    return {
      title: data.title ?? 'Upcoming appointment reminder',
      body: data.body ?? 'You have an upcoming appointment. Open the app for details.',
    };
  }
  if (data.kind === 'appointment_booked') {
    return {
      title: data.title ?? 'Appointment booked',
      body: data.body ?? 'A new appointment has been scheduled for you.',
    };
  }
  return {
    title: data.title ?? 'Notification from your clinic',
    body: data.body ?? 'Please log in to see details.',
  };
}

export async function processPatientOutreachJob(data: OutreachJobData, jobId?: string): Promise<void> {
  if (data.kind === 'appointment_reminder' && data.appointmentId) {
    const appt = await dbAdmin('appointments')
      .where({
        id: data.appointmentId,
        clinic_id: data.clinicId,
        patient_id: data.patientId,
      })
      .whereNull('deleted_at')
      .first('status', 'start_time');

    const status = String(appt?.status ?? '').toLowerCase();
    const isCancelled =
      !appt || ['cancelled', 'no_show', 'completed', 'rescheduled'].includes(status);
    const isPast =
      appt?.start_time != null &&
      Number.isFinite(new Date(String(appt.start_time)).getTime()) &&
      new Date(String(appt.start_time)).getTime() < Date.now() - 10 * 60 * 1000;

    if (isCancelled || isPast) {
      logger.info(
        {
          jobId,
          appointmentId: data.appointmentId,
          clinicId: data.clinicId,
          patientId: data.patientId,
          status,
        },
        'patient-outreach worker — suppressed stale appointment reminder',
      );
      return;
    }
  }

  const { title, body } = defaultOutreachCopy(data);
  const actorStaffId = data.overrideByStaffId ?? 'system';

  const result = await withTenantContext(
    data.clinicId,
    async () =>
      patientOutreachService.send(
        {
          clinicId: data.clinicId,
          patientId: data.patientId,
          kind: data.kind,
          title,
          body,
          deepLink: data.deepLink,
          forceChannel: data.forceChannel,
          overrideReason: data.overrideReason,
        },
        actorStaffId,
      ),
  );

  logger.info(
    { jobId, ...result, kind: data.kind, patientId: data.patientId },
    'patient-outreach worker — dispatch complete',
  );
}

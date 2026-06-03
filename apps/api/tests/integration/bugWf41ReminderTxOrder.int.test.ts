import { describe, it, expect } from 'vitest';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';
import { InMemoryJobBus, jobBus } from '../../src/shared/jobBus';
import { settingsService } from '../../src/features/settings/settingsService';
import { processAppointmentReminders } from '../../src/jobs/schedulers/appointmentReminderScheduler';

const READY = await isIntegrationReady();

function requireInMemoryJobBus(): InMemoryJobBus {
  if (jobBus.backendName !== 'in-memory') {
    throw new Error('bugWf41ReminderTxOrder.int.test.ts requires in-memory jobBus backend');
  }
  return jobBus as InMemoryJobBus;
}

describe.skipIf(!READY)('BUG-WF41-REMINDER-TX-ORDER — appointment reminder scheduling idempotency', () => {
  it('uses deterministic queue job ids and avoids duplicate reminder enqueue on retry', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const session = await loginAsAdmin();
    const bus = requireInMemoryJobBus();
    bus.reset();

    const fixture = await withTenantContext(session.clinicId, async () =>
      dbAdmin('patients as p')
        .join('staff as s', 's.clinic_id', 'p.clinic_id')
        .where('p.clinic_id', session.clinicId)
        .whereNull('p.deleted_at')
        .whereNull('s.deleted_at')
        .whereIn('s.role', ['clinician', 'psychiatrist', 'junior_medical'])
        .select('p.clinic_id as clinic_id', 'p.id as patient_id', 's.id as clinician_id')
        .first(),
    );

    if (!fixture) {
      throw new Error('Test fixture unavailable: no patient/staff pair found for reminder scheduling test');
    }

    const start = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    let appointmentId = '';

    try {
      const [inserted] = await withTenantContext(session.clinicId, async () =>
        dbAdmin('appointments')
          .insert({
            clinic_id: fixture.clinic_id,
            patient_id: fixture.patient_id,
            clinician_id: fixture.clinician_id,
            staff_id: fixture.clinician_id,
            start_time: start,
            end_time: end,
            appointment_start: start,
            appointment_end: end,
            status: 'scheduled',
            type: 'follow_up',
            appointment_type: 'follow_up',
            notes: 'BUG-WF41 reminder scheduler idempotency probe',
            telehealth: false,
            reminder_scheduled: false,
            reminder_sent: false,
          })
          .returning(['id']),
      );

      appointmentId = String(inserted.id);
      const persisted = await withTenantContext(session.clinicId, async () =>
        dbAdmin('appointments')
          .where({ id: appointmentId, clinic_id: session.clinicId })
          .first('start_time'),
      );
      const persistedStart = new Date(String(persisted?.start_time));
      const now = new Date(persistedStart.getTime() - 2 * 24 * 60 * 60 * 1000);

      const thresholds = await settingsService.getThresholds(session.clinicId, dbAdmin);
      const weekDays = (thresholds['appointment_reminder_week_days'] as number) ?? 7;
      const days = (thresholds['appointment_reminder_days'] as number) ?? 1;
      const hours = (thresholds['appointment_reminder_hours'] as number) ?? 2;
      const expectedOffsets = [
        weekDays * 24 * 60 * 60 * 1000,
        days * 24 * 60 * 60 * 1000,
        hours * 60 * 60 * 1000,
      ].filter((offsetMs) => new Date(persistedStart.getTime() - offsetMs) > now);

      const first = await withTenantContext(session.clinicId, () =>
        processAppointmentReminders(now),
      );
      expect(first.processedAppointments).toBeGreaterThan(0);

      const afterFirst = await withTenantContext(session.clinicId, async () =>
        dbAdmin('appointments')
          .where({ id: appointmentId, clinic_id: session.clinicId })
          .first('reminder_scheduled'),
      );
      expect(Boolean(afterFirst?.reminder_scheduled)).toBe(true);

      const emailAfterFirst = bus.dump('email').filter(
        (j) =>
          j.data['type'] === 'appointment_reminder'
          && j.data['clinicId'] === session.clinicId
          && j.data['appointmentId'] === appointmentId,
      );
      const outreachAfterFirst = bus.dump('patient-outreach').filter(
        (j) =>
          j.data['kind'] === 'appointment_reminder'
          && j.data['clinicId'] === session.clinicId
          && j.data['appointmentId'] === appointmentId,
      );
      expect(emailAfterFirst).toHaveLength(expectedOffsets.length);
      expect(outreachAfterFirst).toHaveLength(expectedOffsets.length);
      expect(emailAfterFirst.every((j) => typeof j.opts?.jobId === 'string' && j.opts.jobId.length > 0)).toBe(true);
      expect(outreachAfterFirst.every((j) => typeof j.opts?.jobId === 'string' && j.opts.jobId.length > 0)).toBe(true);

      // Simulate a retry path where reminder_scheduled is still false
      // (e.g., if the final appointment update failed after enqueue).
      await withTenantContext(session.clinicId, async () => {
        await dbAdmin('appointments')
          .where({ id: appointmentId, clinic_id: session.clinicId })
          .update({ reminder_scheduled: false, updated_at: new Date() });
      });

      const second = await withTenantContext(session.clinicId, () =>
        processAppointmentReminders(now),
      );
      expect(second.processedAppointments).toBeGreaterThan(0);

      const emailAfterSecond = bus.dump('email').filter(
        (j) =>
          j.data['type'] === 'appointment_reminder'
          && j.data['clinicId'] === session.clinicId
          && j.data['appointmentId'] === appointmentId,
      );
      const outreachAfterSecond = bus.dump('patient-outreach').filter(
        (j) =>
          j.data['kind'] === 'appointment_reminder'
          && j.data['clinicId'] === session.clinicId
          && j.data['appointmentId'] === appointmentId,
      );
      expect(emailAfterSecond).toHaveLength(expectedOffsets.length);
      expect(outreachAfterSecond).toHaveLength(expectedOffsets.length);
    } finally {
      if (appointmentId) {
        await withTenantContext(session.clinicId, async () => {
          await dbAdmin('appointments').where({ id: appointmentId }).del();
        });
      }
      bus.reset();
    }
  });
});

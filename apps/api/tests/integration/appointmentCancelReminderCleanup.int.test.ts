import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';
import { InMemoryJobBus, jobBus } from '../../src/shared/jobBus';

const READY = await isIntegrationReady();

function requireInMemoryJobBus(): InMemoryJobBus {
  if (jobBus.backendName !== 'in-memory') {
    throw new Error('appointmentCancelReminderCleanup.int.test.ts requires in-memory jobBus backend');
  }
  return jobBus as InMemoryJobBus;
}

describe.skipIf(!READY)('BUG-WF42-CANCEL-CLEANUP-MISSING — cancel clears queued reminder jobs', () => {
  it('removes appointment reminder jobs from email and patient-outreach queues on cancel', async () => {
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
      throw new Error('Test fixture unavailable: no patient/staff pair found for reminder cleanup test');
    }

    const start = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
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
            notes: 'BUG-WF42 reminder cleanup probe',
            telehealth: false,
          })
          .returning(['id']),
      );

      appointmentId = String(inserted.id);

      await bus.enqueue('email', {
        type: 'appointment_reminder',
        clinicId: session.clinicId,
        patientId: fixture.patient_id,
        appointmentId,
        scheduledFor: start.toISOString(),
      });
      await bus.enqueue('patient-outreach', {
        kind: 'appointment_reminder',
        clinicId: session.clinicId,
        patientId: fixture.patient_id,
        appointmentId,
        scheduledFor: start.toISOString(),
      });
      await bus.enqueue('email', {
        type: 'appointment_reminder',
        clinicId: session.clinicId,
        patientId: fixture.patient_id,
        appointmentId: 'unrelated-appt',
        scheduledFor: start.toISOString(),
      });
      await bus.enqueue('patient-outreach', {
        kind: 'appointment_reminder',
        clinicId: session.clinicId,
        patientId: fixture.patient_id,
        appointmentId: 'unrelated-appt',
        scheduledFor: start.toISOString(),
      });

      expect(
        bus.dump('email').filter(
          (j) =>
            j.data['type'] === 'appointment_reminder'
            && j.data['clinicId'] === session.clinicId
            && j.data['appointmentId'] === appointmentId,
        ),
      ).toHaveLength(1);
      expect(
        bus.dump('patient-outreach').filter(
          (j) =>
            j.data['kind'] === 'appointment_reminder'
            && j.data['clinicId'] === session.clinicId
            && j.data['appointmentId'] === appointmentId,
        ),
      ).toHaveLength(1);

      const cancelRes = await request(app)
        .post(`/api/v1/appointments/${appointmentId}/cancel`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({ reason: 'Patient requested cancellation' });

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body?.status).toBe('cancelled');

      expect(
        bus.dump('email').filter(
          (j) =>
            j.data['type'] === 'appointment_reminder'
            && j.data['clinicId'] === session.clinicId
            && j.data['appointmentId'] === appointmentId,
        ),
      ).toHaveLength(0);
      expect(
        bus.dump('patient-outreach').filter(
          (j) =>
            j.data['kind'] === 'appointment_reminder'
            && j.data['clinicId'] === session.clinicId
            && j.data['appointmentId'] === appointmentId,
        ),
      ).toHaveLength(0);

      expect(
        bus.dump('email').filter((j) => j.data['appointmentId'] === 'unrelated-appt'),
      ).toHaveLength(1);
      expect(
        bus.dump('patient-outreach').filter((j) => j.data['appointmentId'] === 'unrelated-appt'),
      ).toHaveLength(1);
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


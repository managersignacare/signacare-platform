import { describe, it, expect } from 'vitest';
import { isIntegrationReady } from './_helpers';
import { loginAsAdmin } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('ARCH-S0-10 — appointments active-slot uniqueness', () => {
  it('rejects duplicate active slot rows for the same clinician in the same clinic', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const session = await loginAsAdmin();

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
      throw new Error('Test fixture unavailable: no patient/staff pair found for appointment uniqueness test');
    }

    const start = new Date('2032-01-01T09:00:00.000Z');
    start.setUTCMinutes(start.getUTCMinutes() + (Math.floor(Date.now() / 1000) % 1000));
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    const insertedIds: string[] = [];

    try {
      await withTenantContext(session.clinicId, async () => {
        const [first] = await dbAdmin('appointments')
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
            notes: 'ARCH-S0-10 uniqueness probe',
            telehealth: false,
          })
          .returning(['id']);
        insertedIds.push(first.id as string);

        let duplicateError: unknown = null;
        try {
          const [second] = await dbAdmin('appointments')
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
              notes: 'ARCH-S0-10 duplicate probe',
              telehealth: false,
            })
            .returning(['id']);
          insertedIds.push(second.id as string);
        } catch (err) {
          duplicateError = err;
        }

        expect(duplicateError).toBeTruthy();
        const code = (duplicateError as { code?: unknown } | null)?.code;
        const message = (duplicateError as { message?: unknown } | null)?.message;
        expect(code).toBe('23505');
        expect(String(message ?? '')).toContain('appointments_active_slot_unique');
      });
    } finally {
      if (insertedIds.length > 0) {
        await withTenantContext(session.clinicId, async () => {
          await dbAdmin('appointments').whereIn('id', insertedIds).del();
        });
      }
    }
  });
});

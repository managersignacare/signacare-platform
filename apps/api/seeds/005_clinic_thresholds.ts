// apps/api/src/db/seeds/005_clinic_thresholds.ts
import type { Knex } from 'knex'

export async function seed(knex: Knex): Promise<void> {
  await knex('clinic_thresholds').del()

  const clinicId = '11111111-1111-1111-1111-111111111111'

  const defaults: Array<{ key: string; value: number; unit: string }> = [
    { key: 'referral_unattended_days', value: 5, unit: 'days' },
    { key: 'referral_urgent_unattended_days', value: 1, unit: 'days' },
    { key: 'referral_emergency_unattended_hours', value: 4, unit: 'hours' },
    { key: 'patient_missed_appointments_trigger', value: 2, unit: 'count' },
    { key: 'lai_overdue_days', value: 3, unit: 'days' },
    { key: 'clozapine_blood_overdue_days', value: 2, unit: 'days' },
    { key: 'mha_expiry_warning_days', value: 14, unit: 'days' },
    { key: 'aims_overdue_days', value: 90, unit: 'days' },
    { key: 'task_overdue_hours', value: 48, unit: 'hours' },
    { key: 'invoice_overdue_days', value: 30, unit: 'days' },
    { key: 'appointment_reminder_weekdays', value: 7, unit: 'days' },
    { key: 'appointment_reminder_days', value: 1, unit: 'days' },
    { key: 'appointment_reminder_hours', value: 2, unit: 'hours' },
  ]

  await knex('clinic_thresholds').insert(
    defaults.map((d) => ({
      id: knex.raw('gen_random_uuid()'),
      clinic_id: clinicId,
      threshold_key: d.key,
      threshold_value: d.value,
      unit: d.unit,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    })),
  )
}


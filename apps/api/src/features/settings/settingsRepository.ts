// apps/api/src/features/settings/settingsRepository.ts
import { randomUUID } from 'crypto'
import { db } from '../../db/db'

export interface ClinicThresholdRow {
  id: string
  clinic_id: string
  threshold_key: string
  threshold_value: string // Knex returns decimals as strings
  unit: string | null
  created_at: string
  updated_at: string
}

export async function findAllByClinic(clinicId: string): Promise<ClinicThresholdRow[]> {
  return db<ClinicThresholdRow>('clinic_thresholds').where({ clinic_id: clinicId })
}

export async function upsertThreshold(
  clinicId: string,
  key: string,
  value: number,
): Promise<void> {
  await db('clinic_thresholds')
    .insert({
      id: randomUUID(),
      clinic_id: clinicId,
      threshold_key: key,
      threshold_value: value,
      updated_at: new Date(),
      created_at: new Date(),
    })
    .onConflict(['clinic_id', 'threshold_key'])
    .merge({ threshold_value: value, updated_at: new Date() })
}


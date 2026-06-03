// apps/api/src/features/endocrinology/insulinRepository.ts
//
// Multi-specialty Phase 4 — Endocrinology: insulin_regimens repository.
//
// Versioned regimen state. Creating a new regimen for a patient sets
// `valid_to` on any current row in the same transaction so there is
// always exactly one "current" regimen per patient at a time.
import { db } from '../../db/db';
import type { Knex } from 'knex';

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
const INSULIN_REGIMEN_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id',
  'basal_drug', 'basal_dose_units', 'basal_frequency',
  'bolus_drug', 'bolus_doses', 'correction_factor', 'carb_ratio',
  'target_low', 'target_high',
  'valid_from', 'valid_to', 'note', 'prescribed_by',
  'created_at', 'updated_at', 'deleted_at',
] as const;

export interface InsulinRegimenRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string | null;
  basal_drug: string | null;
  basal_dose_units: string | null; // DECIMAL → string
  basal_frequency: string | null;
  bolus_drug: string | null;
  bolus_doses: unknown | null;
  correction_factor: string | null;
  carb_ratio: string | null;
  target_low: string | null;
  target_high: string | null;
  valid_from: Date;
  valid_to: Date | null;
  note: string | null;
  prescribed_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface InsulinRegimenRowWithPrescriber extends InsulinRegimenRow {
  prescribed_by_given_name?: string | null;
  prescribed_by_family_name?: string | null;
}

export class InsulinRegimenRepository {
  async listHistory(
    clinicId: string,
    patientId: string,
  ): Promise<InsulinRegimenRowWithPrescriber[]> {
    return db('insulin_regimens as r')
      .leftJoin('staff as s', 's.id', 'r.prescribed_by')
      .where('r.clinic_id', clinicId)
      .where('r.patient_id', patientId)
      .whereNull('r.deleted_at')
      .select(
        'r.*',
        's.given_name as prescribed_by_given_name',
        's.family_name as prescribed_by_family_name',
      )
      .orderBy('r.valid_from', 'desc') as Promise<InsulinRegimenRowWithPrescriber[]>;
  }

  async findCurrent(
    clinicId: string,
    patientId: string,
  ): Promise<InsulinRegimenRowWithPrescriber | null> {
    const row = await db('insulin_regimens as r')
      .leftJoin('staff as s', 's.id', 'r.prescribed_by')
      .where('r.clinic_id', clinicId)
      .where('r.patient_id', patientId)
      .whereNull('r.deleted_at')
      .whereNull('r.valid_to')
      .select(
        'r.*',
        's.given_name as prescribed_by_given_name',
        's.family_name as prescribed_by_family_name',
      )
      .orderBy('r.valid_from', 'desc')
      .first();
    return (row ?? null) as InsulinRegimenRowWithPrescriber | null;
  }

  /**
   * Atomic versioned create: marks any current regimen as ended at
   * `now` and inserts the new row with `valid_to = NULL`. Wrapped in
   * a single transaction so readers never see two "current" rows.
   */
  async createNewVersion(
    row: Omit<Partial<InsulinRegimenRow>, 'id' | 'valid_from' | 'valid_to' | 'created_at' | 'updated_at' | 'deleted_at'> & {
      clinic_id: string;
      patient_id: string;
    },
  ): Promise<InsulinRegimenRow> {
    return db.transaction(async (trx: Knex.Transaction) => {
      const now = new Date();
      await trx<InsulinRegimenRow>('insulin_regimens')
        .where({ clinic_id: row.clinic_id, patient_id: row.patient_id })
        .whereNull('deleted_at')
        .whereNull('valid_to')
        .update({ valid_to: now, updated_at: now });

      const [created] = await trx<InsulinRegimenRow>('insulin_regimens')
        .insert({
          ...row,
          bolus_doses: row.bolus_doses ? JSON.stringify(row.bolus_doses) : null,
          valid_from: now,
          valid_to: null,
          created_at: now,
          updated_at: now,
        } as Partial<InsulinRegimenRow>)
        .returning(INSULIN_REGIMEN_COLUMNS) as InsulinRegimenRow[];
      return created;
    });
  }
}

export const insulinRegimenRepository = new InsulinRegimenRepository();

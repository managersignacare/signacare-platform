import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/db';
import type { LaiGivenCreateDTO } from '@signacare/shared';
export { AimsAssessmentRow } from './aimsAssessmentRepository';

/**
 * @schema-drift-exempt partial-shape
 * BUG-537 — DB table has duplicate legacy + canonical columns
 * (schedule_id + lai_schedule_id, administered_by_id +
 * administered_by_staff_id) plus typed-numeric variants (dose_given_mg)
 * and scheduling columns (expires_at, deferred_to_date, next_due_date)
 * that this repository does not yet write. The interface exposes the
 * legacy column set used today; BUG-537 tracks consolidating the
 * duplicate-canonical pairs and surfacing the scheduling columns.
 */
export interface LaiGivenRow {
  id: string;
  clinic_id: string;
  schedule_id: string;
  patient_id: string;
  administered_by_id: string;
  outcome: string;
  given_date: string;
  dose_given: string;
  injection_site: string | null;
  batch_number: string | null;
  refusal_reason: string | null;
  notes: string | null;
  aims_due: boolean;
  aims_completed: boolean;
  aims_response_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // BUG-PR-R1-12-FIX-S1-lai_given — opt-locking version (preventive).
  lock_version: number;
}

// Phase 0.7.5 c24 D12 — .returning() subset matching LaiGivenRow.
// DB table has duplicate legacy + canonical columns (schedule_id +
// lai_schedule_id, administered_by_id + administered_by_staff_id);
// the interface exposes the legacy set which is what this repo writes.
const LAI_GIVEN_COLUMNS = [
  'id', 'clinic_id', 'schedule_id', 'patient_id', 'administered_by_id',
  'outcome', 'given_date', 'dose_given', 'injection_site', 'batch_number',
  'refusal_reason', 'notes', 'aims_due', 'aims_completed',
  'aims_response_id', 'created_at', 'updated_at', 'deleted_at',
  'lock_version', // BUG-PR-R1-12-FIX-S1-lai_given
] as const;

import { AimsAssessmentRepository } from './aimsAssessmentRepository';
import type { AimsAssessmentCreateDTO } from '@signacare/shared';

const aimsRepo = new AimsAssessmentRepository();

export const laiGivenRepository = {
  async create(
    clinicId: string,
    actorId: string,
    dto: LaiGivenCreateDTO,
    _nextDueDate: string | null,
    trx?: Knex.Transaction,
  ): Promise<LaiGivenRow> {
    const [row] = await (trx ?? db)('lai_given')
      .insert({
        id: uuidv4(),
        clinic_id: clinicId,
        schedule_id: dto.laiScheduleId,
        patient_id: dto.patientId,
        administered_by_id: actorId,
        outcome: dto.outcome ?? 'given',
        given_date: dto.givenDate,
        dose_given: dto.dosGivenMg ?? '',
        injection_site: dto.injectionSite ?? null,
        batch_number: dto.batchNumber ?? null,
        refusal_reason: dto.refusalReason ?? null,
        notes: dto.notes ?? null,
        aims_due: false,
        aims_completed: false,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(LAI_GIVEN_COLUMNS) as LaiGivenRow[];
    return row;
  },

  async findBySchedule(clinicId: string, laiScheduleId: string): Promise<LaiGivenRow[]> {
    return db('lai_given')
      .where({ clinic_id: clinicId, schedule_id: laiScheduleId })
      .whereNull('deleted_at')
      .orderBy('given_date', 'desc') as Promise<LaiGivenRow[]>;
  },

  async countConsecutiveRefusals(
    clinicId: string,
    laiScheduleId: string,
    trx?: Knex.Transaction,
  ): Promise<number> {
    const rows = await (trx ?? db)('lai_given')
      .where({ clinic_id: clinicId, schedule_id: laiScheduleId })
      .whereNull('deleted_at')
      .orderBy('given_date', 'desc')
      .limit(10) as LaiGivenRow[];
    let count = 0;
    for (const row of rows) {
      if (row.outcome === 'refused') count++;
      else break;
    }
    return count;
  },

  async createAims(clinicId: string, staffId: string, dto: AimsAssessmentCreateDTO) {
    return aimsRepo.create(clinicId, staffId, dto);
  },

  async findAimsByPatient(clinicId: string, patientId: string, laiScheduleId?: string) {
    return aimsRepo.findByPatient(clinicId, patientId, laiScheduleId);
  },
};

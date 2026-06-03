// apps/api/src/features/internal-medicine/medRecRepository.ts
//
// Multi-specialty Phase 3 — Internal Medicine: medication_reconciliations
// repository. Snapshot-based med rec; the JSONB `snapshot` column captures
// the medication list at the moment of reconciliation so historical replay
// doesn't depend on time-travelling joins against patient_medications.
import { db } from '../../db/db';

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
const MED_REC_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'context',
  'performed_at', 'performed_by', 'snapshot',
  'continued_count', 'ceased_count', 'modified_count', 'new_count',
  'on_hold_count', 'summary_notes',
  'created_at', 'updated_at', 'deleted_at',
] as const;

export interface MedRecRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string | null;
  context: string;
  performed_at: Date;
  performed_by: string | null;
  snapshot: unknown;
  continued_count: number;
  ceased_count: number;
  modified_count: number;
  new_count: number;
  on_hold_count: number;
  summary_notes: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface MedRecRowWithPerformer extends MedRecRow {
  performed_by_given_name?: string | null;
  performed_by_family_name?: string | null;
}

export class MedRecRepository {
  async listForPatient(clinicId: string, patientId: string): Promise<MedRecRowWithPerformer[]> {
    return db('medication_reconciliations as mr')
      .leftJoin('staff as s', 's.id', 'mr.performed_by')
      .where('mr.clinic_id', clinicId)
      .where('mr.patient_id', patientId)
      .whereNull('mr.deleted_at')
      .select(
        'mr.*',
        's.given_name as performed_by_given_name',
        's.family_name as performed_by_family_name',
      )
      .orderBy('mr.performed_at', 'desc') as Promise<MedRecRowWithPerformer[]>;
  }

  async findById(clinicId: string, id: string): Promise<MedRecRowWithPerformer | null> {
    const row = await db('medication_reconciliations as mr')
      .leftJoin('staff as s', 's.id', 'mr.performed_by')
      .where('mr.clinic_id', clinicId)
      .where('mr.id', id)
      .whereNull('mr.deleted_at')
      .select(
        'mr.*',
        's.given_name as performed_by_given_name',
        's.family_name as performed_by_family_name',
      )
      .first();
    return (row ?? null) as MedRecRowWithPerformer | null;
  }

  async create(
    row: Partial<MedRecRow> & { clinic_id: string; patient_id: string; context: string },
  ): Promise<MedRecRow> {
    const [created] = await db<MedRecRow>('medication_reconciliations')
      .insert({
        ...row,
        snapshot: JSON.stringify(row.snapshot ?? []),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(MED_REC_COLUMNS) as MedRecRow[];
    return created;
  }
}

export const medRecRepository = new MedRecRepository();

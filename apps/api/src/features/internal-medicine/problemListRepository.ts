// apps/api/src/features/internal-medicine/problemListRepository.ts
//
// Multi-specialty Phase 3 — Internal Medicine: problem_list repository.
//
// Tenant-scoped CRUD over the FHIR-Condition-aligned problem_list table.
// Joins staff for the recordedByName display field; never returns
// password_hash or any other sensitive column. Soft-delete aware
// per CLAUDE.md §1.4.
import { db } from '../../db/db';

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
const PROBLEM_LIST_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id',
  'code_system', 'code', 'display', 'category',
  'clinical_status', 'verification_status', 'severity',
  'is_chronic', 'onset_date', 'onset_age_years', 'abatement_date',
  'note', 'recorded_date', 'recorded_by',
  'created_at', 'updated_at', 'deleted_at',
] as const;

export interface ProblemListRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string | null;
  code_system: string;
  code: string;
  display: string;
  category: string;
  clinical_status: string;
  verification_status: string;
  severity: string | null;
  is_chronic: boolean;
  onset_date: string | null;
  onset_age_years: number | null;
  abatement_date: string | null;
  note: string | null;
  recorded_date: Date;
  recorded_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface ProblemListRowWithRecorder extends ProblemListRow {
  recorded_by_given_name?: string | null;
  recorded_by_family_name?: string | null;
}

export interface ListProblemsFilters {
  clinicalStatus?: string;
  isChronic?: boolean;
  category?: string;
}

export class ProblemListRepository {
  async listForPatient(
    clinicId: string,
    patientId: string,
    filters: ListProblemsFilters = {},
  ): Promise<ProblemListRowWithRecorder[]> {
    const query = db('problem_list as pl')
      .leftJoin('staff as s', 's.id', 'pl.recorded_by')
      .where('pl.clinic_id', clinicId)
      .where('pl.patient_id', patientId)
      .whereNull('pl.deleted_at')
      .select(
        'pl.*',
        's.given_name as recorded_by_given_name',
        's.family_name as recorded_by_family_name',
      )
      .orderBy('pl.is_chronic', 'desc')
      .orderBy('pl.recorded_date', 'desc');

    if (filters.clinicalStatus) query.where('pl.clinical_status', filters.clinicalStatus);
    if (filters.category) query.where('pl.category', filters.category);
    if (filters.isChronic !== undefined) query.where('pl.is_chronic', filters.isChronic);

    return query as Promise<ProblemListRowWithRecorder[]>;
  }

  async findById(clinicId: string, id: string): Promise<ProblemListRowWithRecorder | null> {
    const row = await db('problem_list as pl')
      .leftJoin('staff as s', 's.id', 'pl.recorded_by')
      .where('pl.clinic_id', clinicId)
      .where('pl.id', id)
      .whereNull('pl.deleted_at')
      .select(
        'pl.*',
        's.given_name as recorded_by_given_name',
        's.family_name as recorded_by_family_name',
      )
      .first();
    return (row ?? null) as ProblemListRowWithRecorder | null;
  }

  async create(row: Partial<ProblemListRow> & { clinic_id: string; patient_id: string; code: string; display: string }): Promise<ProblemListRow> {
    const [created] = await db<ProblemListRow>('problem_list')
      .insert({
        ...row,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(PROBLEM_LIST_COLUMNS) as ProblemListRow[];
    return created;
  }

  async update(
    clinicId: string,
    id: string,
    patch: Partial<ProblemListRow>,
  ): Promise<ProblemListRow | null> {
    const [updated] = await db<ProblemListRow>('problem_list')
      .where({ clinic_id: clinicId, id })
      .whereNull('deleted_at')
      .update({ ...patch, updated_at: new Date() })
      .returning(PROBLEM_LIST_COLUMNS) as ProblemListRow[];
    return updated ?? null;
  }

  async softDelete(clinicId: string, id: string): Promise<void> {
    await db<ProblemListRow>('problem_list')
      .where({ clinic_id: clinicId, id })
      .whereNull('deleted_at')
      .update({ deleted_at: new Date(), updated_at: new Date() });
  }
}

export const problemListRepository = new ProblemListRepository();

// apps/api/src/features/endocrinology/glucoseRepository.ts
//
// Multi-specialty Phase 4 — Endocrinology: glucose_readings repository.
// Tenant-scoped CRUD with staff-name join. Soft-delete aware.
import { db } from '../../db/db';

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
const GLUCOSE_READING_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'value', 'unit',
  'source', 'meal_context', 'measured_at', 'recorded_by', 'note',
  'created_at', 'updated_at', 'deleted_at',
] as const;

export interface GlucoseReadingRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string | null;
  value: string; // pg DECIMAL → string
  unit: string;
  source: string;
  meal_context: string | null;
  measured_at: Date;
  recorded_by: string | null;
  note: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface GlucoseReadingRowWithRecorder extends GlucoseReadingRow {
  recorded_by_given_name?: string | null;
  recorded_by_family_name?: string | null;
}

export interface ListGlucoseFilters {
  from?: Date;
  to?: Date;
  source?: string;
  limit?: number;
}

export class GlucoseRepository {
  async listForPatient(
    clinicId: string,
    patientId: string,
    filters: ListGlucoseFilters = {},
  ): Promise<GlucoseReadingRowWithRecorder[]> {
    const query = db('glucose_readings as g')
      .leftJoin('staff as s', 's.id', 'g.recorded_by')
      .where('g.clinic_id', clinicId)
      .where('g.patient_id', patientId)
      .whereNull('g.deleted_at')
      .select(
        'g.*',
        's.given_name as recorded_by_given_name',
        's.family_name as recorded_by_family_name',
      )
      .orderBy('g.measured_at', 'desc')
      .limit(filters.limit ?? 200);

    if (filters.from) query.where('g.measured_at', '>=', filters.from);
    if (filters.to) query.where('g.measured_at', '<=', filters.to);
    if (filters.source) query.where('g.source', filters.source);

    return query as Promise<GlucoseReadingRowWithRecorder[]>;
  }

  async create(
    row: {
      clinic_id: string;
      patient_id: string;
      episode_id?: string | null;
      value: number;
      unit: string;
      source: string;
      meal_context?: string | null;
      measured_at: Date;
      recorded_by?: string | null;
      note?: string | null;
    },
  ): Promise<GlucoseReadingRow> {
    const [created] = await db<GlucoseReadingRow>('glucose_readings')
      .insert({
        clinic_id: row.clinic_id,
        patient_id: row.patient_id,
        episode_id: row.episode_id ?? null,
        // pg DECIMAL accepts numeric — knex serialises it correctly.
        value: String(row.value),
        unit: row.unit,
        source: row.source,
        meal_context: row.meal_context ?? null,
        measured_at: row.measured_at,
        recorded_by: row.recorded_by ?? null,
        note: row.note ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      } as unknown as Partial<GlucoseReadingRow>)
      .returning(GLUCOSE_READING_COLUMNS) as GlucoseReadingRow[];
    return created;
  }

  async softDelete(clinicId: string, id: string): Promise<void> {
    await db<GlucoseReadingRow>('glucose_readings')
      .where({ clinic_id: clinicId, id })
      .whereNull('deleted_at')
      .update({ deleted_at: new Date(), updated_at: new Date() });
  }
}

export const glucoseRepository = new GlucoseRepository();

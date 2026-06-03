// apps/api/src/features/paediatrics/paediatricsRepositories.ts
//
// Multi-specialty Phase 5 — Paediatrics: three repositories.
//
// Tenant-scoped CRUD over growth_measurements / immunizations /
// developmental_milestones. All queries include clinic_id (CLAUDE.md
// §1.3) and filter soft-deletes (§1.4). Joined staff names come back
// as denormalised columns so the service layer can format them
// without a second round-trip.
import { db } from '../../db/db';

// Explicit column lists for .returning() (Phase R3 / CLAUDE.md §1.7).
const GROWTH_MEASUREMENT_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'measurement_type',
  'value', 'unit', 'age_at_measurement_days', 'percentile', 'z_score',
  'reference_source', 'measured_at', 'recorded_by', 'note',
  'created_at', 'updated_at', 'deleted_at',
] as const;
const IMMUNIZATION_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'cvx_code',
  'vaccine_name', 'manufacturer', 'series_name', 'dose_number',
  'series_doses', 'administered_date', 'lot_number', 'expiration_date',
  'site', 'route', 'dose_quantity_ml', 'status', 'not_done_reason',
  'note', 'administered_by', 'created_at', 'updated_at', 'deleted_at',
] as const;
const DEVELOPMENTAL_MILESTONE_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'domain', 'milestone',
  'expected_age_months', 'achieved_at_months', 'status', 'note',
  'assessed_at', 'assessed_by', 'created_at', 'updated_at', 'deleted_at',
] as const;

// ── growth_measurements ──────────────────────────────────────────────────

export interface GrowthMeasurementRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string | null;
  measurement_type: string;
  value: string;
  unit: string;
  age_at_measurement_days: number;
  percentile: string | null;
  z_score: string | null;
  reference_source: string | null;
  measured_at: Date;
  recorded_by: string | null;
  note: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface GrowthMeasurementRowWithRecorder extends GrowthMeasurementRow {
  recorded_by_given_name?: string | null;
  recorded_by_family_name?: string | null;
}

export class GrowthMeasurementRepository {
  async listForPatient(
    clinicId: string,
    patientId: string,
  ): Promise<GrowthMeasurementRowWithRecorder[]> {
    return db('growth_measurements as g')
      .leftJoin('staff as s', 's.id', 'g.recorded_by')
      .where('g.clinic_id', clinicId)
      .where('g.patient_id', patientId)
      .whereNull('g.deleted_at')
      .select(
        'g.*',
        's.given_name as recorded_by_given_name',
        's.family_name as recorded_by_family_name',
      )
      .orderBy('g.measured_at', 'desc') as Promise<GrowthMeasurementRowWithRecorder[]>;
  }

  async create(
    row: {
      clinic_id: string;
      patient_id: string;
      episode_id?: string | null;
      measurement_type: string;
      value: number;
      unit: string;
      age_at_measurement_days: number;
      percentile?: number | null;
      z_score?: number | null;
      reference_source?: string | null;
      measured_at: Date;
      recorded_by?: string | null;
      note?: string | null;
    },
  ): Promise<GrowthMeasurementRow> {
    const [created] = await db<GrowthMeasurementRow>('growth_measurements')
      .insert({
        clinic_id: row.clinic_id,
        patient_id: row.patient_id,
        episode_id: row.episode_id ?? null,
        measurement_type: row.measurement_type,
        value: String(row.value),
        unit: row.unit,
        age_at_measurement_days: row.age_at_measurement_days,
        percentile: row.percentile != null ? String(row.percentile) : null,
        z_score: row.z_score != null ? String(row.z_score) : null,
        reference_source: row.reference_source ?? null,
        measured_at: row.measured_at,
        recorded_by: row.recorded_by ?? null,
        note: row.note ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      } as unknown as Partial<GrowthMeasurementRow>)
      .returning(GROWTH_MEASUREMENT_COLUMNS) as GrowthMeasurementRow[];
    return created;
  }
}

// ── immunizations ────────────────────────────────────────────────────────

export interface ImmunizationRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string | null;
  cvx_code: string;
  vaccine_name: string;
  manufacturer: string | null;
  series_name: string | null;
  dose_number: number | null;
  series_doses: number | null;
  administered_date: string;
  lot_number: string | null;
  expiration_date: string | null;
  site: string | null;
  route: string | null;
  dose_quantity_ml: string | null;
  status: string;
  not_done_reason: string | null;
  note: string | null;
  administered_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface ImmunizationRowWithAdmin extends ImmunizationRow {
  administered_by_given_name?: string | null;
  administered_by_family_name?: string | null;
}

export class ImmunizationRepository {
  async listForPatient(
    clinicId: string,
    patientId: string,
  ): Promise<ImmunizationRowWithAdmin[]> {
    return db('immunizations as i')
      .leftJoin('staff as s', 's.id', 'i.administered_by')
      .where('i.clinic_id', clinicId)
      .where('i.patient_id', patientId)
      .whereNull('i.deleted_at')
      .select(
        'i.*',
        's.given_name as administered_by_given_name',
        's.family_name as administered_by_family_name',
      )
      .orderBy('i.administered_date', 'desc') as Promise<ImmunizationRowWithAdmin[]>;
  }

  async create(row: Partial<ImmunizationRow> & {
    clinic_id: string;
    patient_id: string;
    cvx_code: string;
    vaccine_name: string;
    administered_date: string;
  }): Promise<ImmunizationRow> {
    const [created] = await db<ImmunizationRow>('immunizations')
      .insert({
        ...row,
        dose_quantity_ml: row.dose_quantity_ml != null ? String(row.dose_quantity_ml) : null,
        created_at: new Date(),
        updated_at: new Date(),
      } as unknown as Partial<ImmunizationRow>)
      .returning(IMMUNIZATION_COLUMNS) as ImmunizationRow[];
    return created;
  }
}

// ── developmental_milestones ─────────────────────────────────────────────

export interface MilestoneRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string | null;
  domain: string;
  milestone: string;
  expected_age_months: number | null;
  achieved_at_months: number | null;
  status: string;
  note: string | null;
  assessed_at: Date;
  assessed_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface MilestoneRowWithAssessor extends MilestoneRow {
  assessed_by_given_name?: string | null;
  assessed_by_family_name?: string | null;
}

export class MilestoneRepository {
  async listForPatient(
    clinicId: string,
    patientId: string,
  ): Promise<MilestoneRowWithAssessor[]> {
    return db('developmental_milestones as m')
      .leftJoin('staff as s', 's.id', 'm.assessed_by')
      .where('m.clinic_id', clinicId)
      .where('m.patient_id', patientId)
      .whereNull('m.deleted_at')
      .select(
        'm.*',
        's.given_name as assessed_by_given_name',
        's.family_name as assessed_by_family_name',
      )
      .orderBy('m.domain', 'asc')
      .orderBy('m.expected_age_months', 'asc') as Promise<MilestoneRowWithAssessor[]>;
  }

  async create(row: Partial<MilestoneRow> & {
    clinic_id: string;
    patient_id: string;
    domain: string;
    milestone: string;
  }): Promise<MilestoneRow> {
    const [created] = await db<MilestoneRow>('developmental_milestones')
      .insert({
        ...row,
        created_at: new Date(),
        updated_at: new Date(),
      } as Partial<MilestoneRow>)
      .returning(DEVELOPMENTAL_MILESTONE_COLUMNS) as MilestoneRow[];
    return created;
  }
}

export const growthMeasurementRepository = new GrowthMeasurementRepository();
export const immunizationRepository = new ImmunizationRepository();
export const milestoneRepository = new MilestoneRepository();

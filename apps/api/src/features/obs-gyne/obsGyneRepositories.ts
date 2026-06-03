// apps/api/src/features/obs-gyne/obsGyneRepositories.ts
//
// Multi-specialty Phase 6 — Obstetrics & Gynaecology: repositories.
//
// Tenant-scoped CRUD for pregnancies and antenatal_visits. Every
// query includes clinic_id (CLAUDE.md §1.3) and filters soft-deletes
// (§1.4). Staff names come back as denormalised snake_case columns
// so the camelCaseResponse middleware can convert them cleanly
// (ALIAS1-4 Fix Registry pattern).
import { db } from '../../db/db';

// Explicit column lists for .returning() (Phase R3 / CLAUDE.md §1.7).
const PREGNANCY_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'lmp_date', 'edd_date',
  'gtpal', 'status', 'note', 'recorded_by',
  'created_at', 'updated_at', 'deleted_at',
] as const;
const ANTENATAL_VISIT_COLUMNS = [
  'id', 'clinic_id', 'pregnancy_id', 'patient_id', 'visit_number',
  'visit_date', 'ga_weeks', 'ga_days', 'fundal_height_cm',
  'fetal_heart_rate_bpm', 'bp_systolic', 'bp_diastolic',
  'urine_protein', 'urine_glucose', 'oedema', 'note', 'seen_by',
  'created_at', 'updated_at', 'deleted_at',
] as const;

// ── pregnancies ─────────────────────────────────────────────────────────────

export interface PregnancyRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string | null;
  // Postgres `date` columns round-trip as strings via pg driver, but
  // Knex's typed query builder also accepts Date when inserting.
  lmp_date: string | Date;
  edd_date: string | Date;
  gtpal: unknown;
  status: string;
  note: string | null;
  recorded_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface PregnancyRowWithRecorder extends PregnancyRow {
  recorded_by_given_name?: string | null;
  recorded_by_family_name?: string | null;
}

export class PregnancyRepository {
  async listForPatient(clinicId: string, patientId: string): Promise<PregnancyRowWithRecorder[]> {
    return db('pregnancies as p')
      .leftJoin('staff as s', 's.id', 'p.recorded_by')
      .where('p.clinic_id', clinicId)
      .where('p.patient_id', patientId)
      .whereNull('p.deleted_at')
      .select(
        'p.*',
        's.given_name as recorded_by_given_name',
        's.family_name as recorded_by_family_name',
      )
      .orderBy('p.lmp_date', 'desc') as Promise<PregnancyRowWithRecorder[]>;
  }

  async findById(clinicId: string, id: string): Promise<PregnancyRow | undefined> {
    return db<PregnancyRow>('pregnancies')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .first();
  }

  async create(row: {
    clinic_id: string;
    patient_id: string;
    episode_id?: string | null;
    lmp_date: string;
    edd_date: string;
    gtpal: unknown;
    status: string;
    note?: string | null;
    recorded_by?: string | null;
  }): Promise<PregnancyRow> {
    const [created] = await db<PregnancyRow>('pregnancies')
      .insert({
        clinic_id: row.clinic_id,
        patient_id: row.patient_id,
        episode_id: row.episode_id ?? null,
        lmp_date: row.lmp_date,
        edd_date: row.edd_date,
        gtpal: JSON.stringify(row.gtpal),
        status: row.status,
        note: row.note ?? null,
        recorded_by: row.recorded_by ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(PREGNANCY_COLUMNS) as PregnancyRow[];
    return created;
  }
}

// ── antenatal_visits ────────────────────────────────────────────────────────

export interface AntenatalVisitRow {
  id: string;
  clinic_id: string;
  pregnancy_id: string;
  patient_id: string;
  visit_number: number;
  visit_date: string | Date;
  ga_weeks: number;
  ga_days: number;
  fundal_height_cm: string | null;
  fetal_heart_rate_bpm: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  urine_protein: string | null;
  urine_glucose: string | null;
  oedema: boolean | null;
  note: string | null;
  seen_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface AntenatalVisitRowWithSeer extends AntenatalVisitRow {
  seen_by_given_name?: string | null;
  seen_by_family_name?: string | null;
}

export class AntenatalVisitRepository {
  async listForPregnancy(
    clinicId: string,
    pregnancyId: string,
  ): Promise<AntenatalVisitRowWithSeer[]> {
    return db('antenatal_visits as v')
      .leftJoin('staff as s', 's.id', 'v.seen_by')
      .where('v.clinic_id', clinicId)
      .where('v.pregnancy_id', pregnancyId)
      .whereNull('v.deleted_at')
      .select(
        'v.*',
        's.given_name as seen_by_given_name',
        's.family_name as seen_by_family_name',
      )
      .orderBy('v.visit_date', 'desc') as Promise<AntenatalVisitRowWithSeer[]>;
  }

  async create(row: {
    clinic_id: string;
    pregnancy_id: string;
    patient_id: string;
    visit_number: number;
    visit_date: string;
    ga_weeks: number;
    ga_days: number;
    fundal_height_cm?: number | null;
    fetal_heart_rate_bpm?: number | null;
    bp_systolic?: number | null;
    bp_diastolic?: number | null;
    urine_protein?: string | null;
    urine_glucose?: string | null;
    oedema?: boolean | null;
    note?: string | null;
    seen_by?: string | null;
  }): Promise<AntenatalVisitRow> {
    const [created] = await db<AntenatalVisitRow>('antenatal_visits')
      .insert({
        clinic_id: row.clinic_id,
        pregnancy_id: row.pregnancy_id,
        patient_id: row.patient_id,
        visit_number: row.visit_number,
        visit_date: row.visit_date,
        ga_weeks: row.ga_weeks,
        ga_days: row.ga_days,
        fundal_height_cm: row.fundal_height_cm != null ? String(row.fundal_height_cm) : null,
        fetal_heart_rate_bpm: row.fetal_heart_rate_bpm ?? null,
        bp_systolic: row.bp_systolic ?? null,
        bp_diastolic: row.bp_diastolic ?? null,
        urine_protein: row.urine_protein ?? null,
        urine_glucose: row.urine_glucose ?? null,
        oedema: row.oedema ?? null,
        note: row.note ?? null,
        seen_by: row.seen_by ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(ANTENATAL_VISIT_COLUMNS) as AntenatalVisitRow[];
    return created;
  }
}

export const pregnancyRepository = new PregnancyRepository();
export const antenatalVisitRepository = new AntenatalVisitRepository();

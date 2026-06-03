// apps/api/src/features/reports/reports.repository.ts
//
// S2.5: SELECT-only queries route through `dbRead` (the read replica
// when DB_REPLICA_HOST is set; falls back to the primary pool when not).
// The single write (createReportRun) keeps `db` so it always lands on
// the primary. db.raw() is left untouched throughout because it builds
// a SQL fragment at query-build time and is not coupled to any pool.
import { db, dbRead } from '../../db/db';
import type {
  ReportFilters,
  EncounterReportRow,
  StaffOption,
} from '@signacare/shared';

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// Matches ReportRunRow + real report_runs schema.
const REPORT_RUN_COLUMNS = [
  'id', 'clinic_id', 'requested_by_id', 'report_type', 'filters',
  'format', 'status', 'total_rows', 'result_data', 'error_message',
  'generated_at', 'created_at', 'updated_at',
] as const;

// Mirrors `report_runs` exactly. Phase 0.7.5 c24 C6 (SD18) fixed 6
// missing-underscore ghost columns (requestedbyid → requested_by_id,
// reporttype → report_type, totalrows → total_rows, resultdata →
// result_data, errormessage → error_message, generatedat → generated_at).
// Every report save previously crashed at runtime.
export interface ReportRunRow {
  id: string;
  clinic_id: string;
  requested_by_id: string;
  report_type: string;
  filters: object;
  format: string;
  status: string;
  total_rows: number;
  result_data: unknown;
  error_message: string | null;
  generated_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface OutcomeDataRow {
  submissionid: string;
  patient_id: string;
  patientname: string;
  instrument: string;
  totalscore: string | null;
  scoreband: string | null;
  assessmentdate: Date | string;
  clinicianname: string;
}

interface EncounterQueryRow {
  encounter_id: string;
  patient_id: string;
  patient_name: string;
  encounter_date: Date | string;
  encounter_type: string;
  clinician_name: string;
  episode_type: string | null;
  status: string;
}

interface StaffFilterRow {
  id: string;
  fullname: string;
  discipline: string | null;
}

export const reportsRepository = {
  async getEncounterRows(
    clinicId: string,
    filters: ReportFilters,
  ): Promise<EncounterReportRow[]> {
    const q = dbRead<EncounterQueryRow>('clinical_notes as n')
      .join('patients as p', 'p.id', 'n.patient_id')
      .join('staff as s', 's.id', 'n.author_id')
      .leftJoin('episodes as e', 'e.id', 'n.episode_id')
      .where('n.clinic_id', clinicId)
      .whereNull('n.deleted_at')
      .whereRaw("n.note_date BETWEEN ? AND ?", [filters.dateFrom, filters.dateTo])
      .select(
        'n.id as encounter_id',
        'n.patient_id as patient_id',
        db.raw("CONCAT(p.given_name, ' ', p.family_name) AS patient_name"),
        'n.created_at as encounter_date',
        'n.note_category as encounter_type',
        db.raw("CONCAT(s.given_name, ' ', s.family_name) AS clinician_name"),
        'e.episode_type as episode_type',
        db.raw("CASE WHEN n.is_signed THEN 'signed' ELSE 'draft' END AS status"),
      )
      .orderBy('n.created_at', 'desc');

    if (filters.clinicianStaffId) {
      q.andWhere('n.author_id', filters.clinicianStaffId);
    }
    if (filters.episodeType) {
      q.andWhere('e.episode_type', filters.episodeType);
    }

    const rows = await q;
    return rows.map((r) => ({
      encounterId: r.encounter_id,
      patientId: r.patient_id,
      patientName: r.patient_name,
      encounterDate:
        r.encounter_date instanceof Date
          ? r.encounter_date.toISOString()
          : String(r.encounter_date),
      encounterType: r.encounter_type,
      clinicianName: r.clinician_name,
      episodeType: r.episode_type ?? null,
      durationMinutes: null,
      status: r.status,
    }));
  },

  async getOutcomeRows(
    clinicId: string,
    filters: ReportFilters,
  ): Promise<OutcomeDataRow[]> {
    const INSTRUMENTS = ['PHQ9', 'GAD7', 'K10', 'HONOS', 'BPRS', 'DASS21'];

    // PR-R1-13 DRAIN (2026-05-01): assessment_responses ghost-column drift —
    // the table has [id, patient_id, clinic_id, episode_id, staff_id,
    // template_id, assessment_type, responses, total_score, severity,
    // collection_occasion, created_at, updated_at] per schema-snapshot.json.
    // Pre-fix this query referenced 4 ghost columns (a.completed_by_id,
    // a.deleted_at, a.completed_at, a.interpretation_band) that DON'T exist.
    // Renames: completed_by_id→staff_id, completed_at→created_at,
    // interpretation_band→severity. The deleted_at filter is removed
    // (assessment_responses has no soft-delete per CLAUDE.md §1.4).
    const q = dbRead<OutcomeDataRow>('assessment_responses as a')
      .join('patients as p', 'p.id', 'a.patient_id')
      .join('assessment_templates as t', 't.id', 'a.template_id')
      .join('staff as s', 's.id', 'a.staff_id')
      .where('a.clinic_id', clinicId)
      .whereIn('t.code', INSTRUMENTS)
      .whereRaw("a.created_at::date BETWEEN ? AND ?", [filters.dateFrom, filters.dateTo])
      .select(
        'a.id as submission_id',
        'a.patient_id as patient_id',
        db.raw("CONCAT(p.given_name, ' ', p.family_name) AS patient_name"),
        't.code as instrument',
        'a.total_score as total_score',
        'a.severity as score_band',
        'a.created_at as assessment_date',
        db.raw("CONCAT(s.given_name, ' ', s.family_name) AS clinician_name"),
      )
      .orderBy('a.created_at', 'asc');

    if (filters.clinicianStaffId) {
      q.andWhere('a.staff_id', filters.clinicianStaffId);
    }

    return q as Promise<OutcomeDataRow[]>;
  },

  async getCliniciansForFilter(clinicId: string): Promise<StaffOption[]> {
    const rows = await dbRead<StaffFilterRow>('staff as s')
      .where('s.clinic_id', clinicId)
      .whereNull('s.deleted_at')
      .where('s.is_active', true)
      .select(
        's.id',
        db.raw("CONCAT(s.given_name, ' ', s.family_name) AS fullname"),
        db.raw("NULLIF(TRIM(s.discipline), '') as discipline"),
      )
      .orderByRaw('s.family_name, s.given_name');

    return rows.map((r) => ({
      id: r.id,
      fullName: r.fullname,
      profession: r.discipline ?? undefined,
    }));
  },

  async createReportRun(
    clinicId: string,
    staffId: string,
    reportType: string,
    filters: ReportFilters,
    format: string,
    totalRows: number,
    resultData: unknown,
  ): Promise<ReportRunRow> {
    const [row] = await db<ReportRunRow>('report_runs')
      .insert({
        clinic_id: clinicId,
        requested_by_id: staffId,
        report_type: reportType,
        filters: filters as unknown as object,
        format,
        status: 'completed',
        total_rows: totalRows,
        result_data: JSON.stringify(resultData),
        generated_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(REPORT_RUN_COLUMNS);
    return row;
  },

  async findReportRun(
    clinicId: string,
    reportId: string,
  ): Promise<ReportRunRow | undefined> {
    return dbRead<ReportRunRow>('report_runs')
      .where({ clinic_id: clinicId, id: reportId })
      .first();
  },
};

// apps/api/src/features/surgery/surgeryRepositories.ts
//
// Multi-specialty Phase 7 — Surgery: repositories.
//
// Tenant-scoped CRUD over surgical_cases / safety_checklists /
// op_notes / pacu_records. Every query includes clinic_id
// (CLAUDE.md §1.3) and filters soft-deletes (§1.4). Joined staff
// names come back as denormalised snake_case columns so the
// camelCaseResponse middleware can transform them (ALIAS1-4
// Fix Registry pattern).
//
// Phase 0b.2c-batch-4 (2026-05-06): drain hand-written
// SURGICAL_CASE / SAFETY_CHECKLIST / OP_NOTE / PACU_RECORD column
// lists to migration-driven SSoT per Phase 0b.2 plan + CLAUDE.md §15.
//
// permanent: alias re-exports (singular hand-written → plural generated)
// IS the end-state per Phase 0b.2 DoD. Migration-driven SSoT
// auto-propagates forward when migrations land; alias preserves
// backward-compat naming without external consumer churn (all 4
// constants are module-private — zero external consumers per grep).
import { db } from '../../db/db';
import { SURGICAL_CASES_COLUMNS } from '../../db/types/surgical_cases';
import { SAFETY_CHECKLISTS_COLUMNS } from '../../db/types/safety_checklists';
import { OP_NOTES_COLUMNS } from '../../db/types/op_notes';
import { PACU_RECORDS_COLUMNS } from '../../db/types/pacu_records';

// Phase 0.7.5 c24 D7b — explicit column lists for .returning() calls.
const SURGICAL_CASE_COLUMNS = SURGICAL_CASES_COLUMNS;
const SAFETY_CHECKLIST_COLUMNS = SAFETY_CHECKLISTS_COLUMNS;
const OP_NOTE_COLUMNS = OP_NOTES_COLUMNS;
const PACU_RECORD_COLUMNS = PACU_RECORDS_COLUMNS;

// ── surgical_cases ─────────────────────────────────────────────────────────

export interface SurgicalCaseRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string | null;
  procedure_code: string;
  procedure_display: string;
  primary_surgeon_id: string | null;
  planned_date: string | Date;
  urgency: string;
  asa_class: number;
  consent_status: string;
  status: string;
  note: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface SurgicalCaseRowWithSurgeon extends SurgicalCaseRow {
  primary_surgeon_given_name?: string | null;
  primary_surgeon_family_name?: string | null;
}

export class SurgicalCaseRepository {
  async listForPatient(clinicId: string, patientId: string): Promise<SurgicalCaseRowWithSurgeon[]> {
    return db('surgical_cases as c')
      .leftJoin('staff as s', 's.id', 'c.primary_surgeon_id')
      .where('c.clinic_id', clinicId)
      .where('c.patient_id', patientId)
      .whereNull('c.deleted_at')
      .select(
        'c.*',
        's.given_name as primary_surgeon_given_name',
        's.family_name as primary_surgeon_family_name',
      )
      .orderBy('c.planned_date', 'desc') as Promise<SurgicalCaseRowWithSurgeon[]>;
  }

  async findById(clinicId: string, id: string): Promise<SurgicalCaseRow | undefined> {
    return db<SurgicalCaseRow>('surgical_cases')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .first();
  }

  async create(row: Omit<SurgicalCaseRow, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>): Promise<SurgicalCaseRow> {
    const [created] = await db<SurgicalCaseRow>('surgical_cases')
      .insert({
        ...row,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(SURGICAL_CASE_COLUMNS) as SurgicalCaseRow[];
    return created;
  }
}

// ── safety_checklists ──────────────────────────────────────────────────────

export interface SafetyChecklistRow {
  id: string;
  clinic_id: string;
  case_id: string;
  phase: string;
  items: unknown;
  completed_by: string | null;
  completed_at: Date;
  created_at: Date;
  deleted_at: Date | null;
}

export interface SafetyChecklistRowWithActor extends SafetyChecklistRow {
  completed_by_given_name?: string | null;
  completed_by_family_name?: string | null;
}

export class SafetyChecklistRepository {
  async listForCase(clinicId: string, caseId: string): Promise<SafetyChecklistRowWithActor[]> {
    return db('safety_checklists as k')
      .leftJoin('staff as s', 's.id', 'k.completed_by')
      .where('k.clinic_id', clinicId)
      .where('k.case_id', caseId)
      .whereNull('k.deleted_at')
      .select(
        'k.*',
        's.given_name as completed_by_given_name',
        's.family_name as completed_by_family_name',
      )
      .orderBy('k.completed_at', 'asc') as Promise<SafetyChecklistRowWithActor[]>;
  }

  async countPhasesForCase(clinicId: string, caseId: string): Promise<number> {
    const [row] = await db('safety_checklists')
      .where({ clinic_id: clinicId, case_id: caseId })
      .whereNull('deleted_at')
      .countDistinct({ count: 'phase' });
    return Number((row as { count: string | number }).count);
  }

  async create(row: {
    clinic_id: string;
    case_id: string;
    phase: string;
    items: unknown;
    completed_by: string | null;
  }): Promise<SafetyChecklistRow> {
    const [created] = await db<SafetyChecklistRow>('safety_checklists')
      .insert({
        clinic_id: row.clinic_id,
        case_id: row.case_id,
        phase: row.phase,
        items: JSON.stringify(row.items),
        completed_by: row.completed_by,
        completed_at: new Date(),
        created_at: new Date(),
      })
      .returning(SAFETY_CHECKLIST_COLUMNS) as SafetyChecklistRow[];
    return created;
  }
}

// ── op_notes ───────────────────────────────────────────────────────────────

export interface OpNoteRow {
  id: string;
  clinic_id: string;
  case_id: string;
  indication: string;
  findings: string;
  procedure_text: string;
  complications: string | null;
  estimated_blood_loss_ml: number | null;
  specimens: unknown;
  closed_by: string | null;
  closed_at: Date;
  created_at: Date;
  deleted_at: Date | null;
}

export interface OpNoteRowWithActor extends OpNoteRow {
  closed_by_given_name?: string | null;
  closed_by_family_name?: string | null;
}

export class OpNoteRepository {
  async findForCase(clinicId: string, caseId: string): Promise<OpNoteRowWithActor | undefined> {
    return db('op_notes as n')
      .leftJoin('staff as s', 's.id', 'n.closed_by')
      .where('n.clinic_id', clinicId)
      .where('n.case_id', caseId)
      .whereNull('n.deleted_at')
      .select(
        'n.*',
        's.given_name as closed_by_given_name',
        's.family_name as closed_by_family_name',
      )
      .first() as Promise<OpNoteRowWithActor | undefined>;
  }

  async create(row: {
    clinic_id: string;
    case_id: string;
    indication: string;
    findings: string;
    procedure_text: string;
    complications: string | null;
    estimated_blood_loss_ml: number | null;
    specimens: unknown;
    closed_by: string | null;
  }): Promise<OpNoteRow> {
    const [created] = await db<OpNoteRow>('op_notes')
      .insert({
        clinic_id: row.clinic_id,
        case_id: row.case_id,
        indication: row.indication,
        findings: row.findings,
        procedure_text: row.procedure_text,
        complications: row.complications,
        estimated_blood_loss_ml: row.estimated_blood_loss_ml,
        specimens: JSON.stringify(row.specimens ?? []),
        closed_by: row.closed_by,
        closed_at: new Date(),
        created_at: new Date(),
      })
      .returning(OP_NOTE_COLUMNS) as OpNoteRow[];
    return created;
  }
}

// ── pacu_records ───────────────────────────────────────────────────────────

export interface PacuRecordRow {
  id: string;
  clinic_id: string;
  case_id: string;
  vitals: unknown;
  aldrete_score: number;
  discharge_criteria_met: boolean;
  recovery_end_at: Date | null;
  note: string | null;
  recorded_by: string | null;
  created_at: Date;
  deleted_at: Date | null;
}

export interface PacuRecordRowWithActor extends PacuRecordRow {
  recorded_by_given_name?: string | null;
  recorded_by_family_name?: string | null;
}

export class PacuRecordRepository {
  async listForCase(clinicId: string, caseId: string): Promise<PacuRecordRowWithActor[]> {
    return db('pacu_records as p')
      .leftJoin('staff as s', 's.id', 'p.recorded_by')
      .where('p.clinic_id', clinicId)
      .where('p.case_id', caseId)
      .whereNull('p.deleted_at')
      .select(
        'p.*',
        's.given_name as recorded_by_given_name',
        's.family_name as recorded_by_family_name',
      )
      .orderBy('p.created_at', 'desc') as Promise<PacuRecordRowWithActor[]>;
  }

  async create(row: {
    clinic_id: string;
    case_id: string;
    vitals: unknown;
    aldrete_score: number;
    discharge_criteria_met: boolean;
    recovery_end_at: Date | null;
    note: string | null;
    recorded_by: string | null;
  }): Promise<PacuRecordRow> {
    const [created] = await db<PacuRecordRow>('pacu_records')
      .insert({
        clinic_id: row.clinic_id,
        case_id: row.case_id,
        vitals: JSON.stringify(row.vitals),
        aldrete_score: row.aldrete_score,
        discharge_criteria_met: row.discharge_criteria_met,
        recovery_end_at: row.recovery_end_at,
        note: row.note,
        recorded_by: row.recorded_by,
        created_at: new Date(),
      })
      .returning(PACU_RECORD_COLUMNS) as PacuRecordRow[];
    return created;
  }
}

export const surgicalCaseRepository = new SurgicalCaseRepository();
export const safetyChecklistRepository = new SafetyChecklistRepository();
export const opNoteRepository = new OpNoteRepository();
export const pacuRecordRepository = new PacuRecordRepository();

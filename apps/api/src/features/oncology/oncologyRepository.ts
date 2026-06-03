// apps/api/src/features/oncology/oncologyRepository.ts
//
// Phase 8 — Oncology repository. One class per clinical entity, all
// tenant-scoped by clinic_id per CLAUDE.md §1.3 + §1.4. Every list
// filters soft-deletes where the table has a `deleted_at` column
// (primary_cancer_conditions + cancer_treatment_plans); TNM groups,
// ECOG, chemo cycles and tumour board decisions are ledger tables
// that do not soft-delete.
//
// Phase 0.7.5 c24 D6 — proper Row interfaces + explicit column lists.
// Prior code returned untyped rows (`any`), which meant schema drift
// on these tables would go unnoticed. Interfaces and column lists
// pulled from schema-snapshot.json on 2026-04-17.
//
// Phase 0b.2c-batch-5 (2026-05-06): drain hand-written column lists
// to migration-driven SSoT per Phase 0b.2 plan + CLAUDE.md §15.
//
// permanent: alias re-exports IS the end-state per Phase 0b.2 DoD.
// Migration-driven SSoT auto-propagates forward when migrations land.
// Zero external consumers per grep — all 6 are module-private `const`.
//
// Pattern variation in this batch (per operator watchpoint 2026-05-06
// "call out when the pattern changes"):
//   - 5 standard singular→plural aliases (PRIMARY_CANCER_CONDITION /
//     TNM_STAGE_GROUP / CANCER_TREATMENT_PLAN / CHEMO_CYCLE /
//     TUMOUR_BOARD_DECISION → corresponding *_S_COLUMNS).
//   - 1 NAME-SHORTENING alias: ECOG_COLUMNS = ECOG_PERFORMANCE_STATUS_COLUMNS.
//     The hand-written constant uses the clinical abbreviation `ECOG`
//     while the generated constant follows the full table name
//     `ecog_performance_status`. Alias preserves backward-compat
//     shorthand without external consumer churn (zero external consumers).
//   The migration shape (alias re-export) is the same for all 6;
//   the variation is the alias-bridge target name (singular→plural
//   vs abbreviation→full-table-name). Equivalence class is unchanged
//   (still byte-equivalent column lists).
import { db } from '../../db/db';
import { PRIMARY_CANCER_CONDITIONS_COLUMNS } from '../../db/types/primary_cancer_conditions';
import { TNM_STAGE_GROUPS_COLUMNS } from '../../db/types/tnm_stage_groups';
import { ECOG_PERFORMANCE_STATUS_COLUMNS } from '../../db/types/ecog_performance_status';
import { CANCER_TREATMENT_PLANS_COLUMNS } from '../../db/types/cancer_treatment_plans';
import { CHEMO_CYCLES_COLUMNS } from '../../db/types/chemo_cycles';
import { TUMOUR_BOARD_DECISIONS_COLUMNS } from '../../db/types/tumour_board_decisions';

// ── Row types ─────────────────────────────────────────────────────────

// DATE/TIMESTAMP columns are typed as `Date | string` because Knex returns
// raw Postgres date strings for `date` columns and Date objects for
// `timestamptz` columns — and the exact shape depends on the driver's
// type-parser configuration. The mappers below use `instanceof Date`
// to normalise both at runtime; the union type keeps that check valid.
export interface PrimaryCancerConditionRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string | null;
  icd10: string | null;
  snomed: string | null;
  histology: string | null;
  laterality: string | null;
  diagnosis_date: Date | string;
  stage_system: string | null;
  notes: string | null;
  created_by_staff_id: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface TnmStageGroupRow {
  id: string;
  clinic_id: string;
  condition_id: string;
  t: string | null;
  n: string | null;
  m: string | null;
  stage_group: string | null;
  staged_at: Date | string;
  staged_by_staff_id: string;
  notes: string | null;
  created_at: Date;
}

export interface EcogPerformanceStatusRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  score: number;
  assessed_at: Date | string;
  assessed_by_staff_id: string;
  notes: string | null;
  created_at: Date;
}

export interface CancerTreatmentPlanRow {
  id: string;
  clinic_id: string;
  condition_id: string;
  regimen_name: string;
  intent: string;
  protocol_ref: string | null;
  start_date: Date | string;
  end_date: Date | string | null;
  status: string;
  notes: string | null;
  created_by_staff_id: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface ChemoCycleRow {
  id: string;
  clinic_id: string;
  plan_id: string;
  cycle_number: number;
  planned_date: Date | string;
  actual_date: Date | string | null;
  status: string;
  dose_modifications: unknown;
  toxicity_ctcae: unknown;
  notes: string | null;
  administered_by_staff_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface TumourBoardDecisionRow {
  id: string;
  clinic_id: string;
  condition_id: string;
  meeting_date: Date | string;
  recommendation: string;
  rationale: string | null;
  attendee_staff_ids: string[] | null;
  chaired_by_staff_id: string;
  created_at: Date;
}

function toIsoDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function toIsoDateTime(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parseJsonbRecord(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function mapChemoCycleToResponse(row: ChemoCycleRow) {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    planId: row.plan_id,
    cycleNumber: typeof row.cycle_number === 'number' ? row.cycle_number : Number(row.cycle_number),
    plannedDate: toIsoDate(row.planned_date),
    actualDate: toIsoDate(row.actual_date),
    status: row.status,
    doseModifications: parseJsonbRecord(row.dose_modifications),
    // BUG-ONC-* JSONB extraction proof for guard:jsonb-extraction
    toxicityCtcae: parseJsonbRecord(row.toxicity_ctcae),
    notes: row.notes,
    administeredByStaffId: row.administered_by_staff_id,
    createdAt: toIsoDateTime(row.created_at),
    updatedAt: toIsoDateTime(row.updated_at),
  };
}

// ── Column constants ──────────────────────────────────────────────────

const PRIMARY_CANCER_CONDITION_COLUMNS = PRIMARY_CANCER_CONDITIONS_COLUMNS;
const TNM_STAGE_GROUP_COLUMNS = TNM_STAGE_GROUPS_COLUMNS;
const ECOG_COLUMNS = ECOG_PERFORMANCE_STATUS_COLUMNS;
const CANCER_TREATMENT_PLAN_COLUMNS = CANCER_TREATMENT_PLANS_COLUMNS;
const CHEMO_CYCLE_COLUMNS = CHEMO_CYCLES_COLUMNS;
const TUMOUR_BOARD_DECISION_COLUMNS = TUMOUR_BOARD_DECISIONS_COLUMNS;

// ── PrimaryCancerCondition ────────────────────────────────────────────

export const primaryCancerConditionRepo = {
  async listForPatient(
    clinicId: string,
    patientId: string,
  ): Promise<PrimaryCancerConditionRow[]> {
    return db<PrimaryCancerConditionRow>('primary_cancer_conditions')
      .where({ clinic_id: clinicId, patient_id: patientId })
      .whereNull('deleted_at')
      .orderBy('diagnosis_date', 'desc');
  },

  async findById(
    clinicId: string,
    id: string,
  ): Promise<PrimaryCancerConditionRow | null> {
    const row = await db<PrimaryCancerConditionRow>('primary_cancer_conditions')
      .where({ clinic_id: clinicId, id })
      .whereNull('deleted_at')
      .first();
    return row ?? null;
  },

  async create(
    clinicId: string,
    staffId: string,
    dto: {
      patientId: string;
      episodeId?: string;
      icd10?: string;
      snomed?: string;
      histology?: string;
      laterality?: string;
      diagnosisDate: string;
      stageSystem?: string;
      notes?: string;
    },
  ): Promise<PrimaryCancerConditionRow> {
    const rows = await db<PrimaryCancerConditionRow>('primary_cancer_conditions')
      .insert({
        clinic_id: clinicId,
        patient_id: dto.patientId,
        episode_id: dto.episodeId ?? null,
        icd10: dto.icd10 ?? null,
        snomed: dto.snomed ?? null,
        histology: dto.histology ?? null,
        laterality: dto.laterality ?? null,
        diagnosis_date: dto.diagnosisDate,
        stage_system: dto.stageSystem ?? null,
        notes: dto.notes ?? null,
        created_by_staff_id: staffId,
      })
      .returning(PRIMARY_CANCER_CONDITION_COLUMNS) as PrimaryCancerConditionRow[];
    return rows[0];
  },
};

// ── TNMStageGroup ─────────────────────────────────────────────────────

export const tnmStageGroupRepo = {
  async listForCondition(
    clinicId: string,
    conditionId: string,
  ): Promise<TnmStageGroupRow[]> {
    return db<TnmStageGroupRow>('tnm_stage_groups')
      .where({ clinic_id: clinicId, condition_id: conditionId })
      .orderBy('staged_at', 'desc');
  },

  async create(
    clinicId: string,
    staffId: string,
    dto: {
      conditionId: string;
      t?: string;
      n?: string;
      m?: string;
      stageGroup?: string;
      notes?: string;
    },
  ): Promise<TnmStageGroupRow> {
    const rows = await db<TnmStageGroupRow>('tnm_stage_groups')
      .insert({
        clinic_id: clinicId,
        condition_id: dto.conditionId,
        t: dto.t ?? null,
        n: dto.n ?? null,
        m: dto.m ?? null,
        stage_group: dto.stageGroup ?? null,
        staged_by_staff_id: staffId,
        notes: dto.notes ?? null,
      })
      .returning(TNM_STAGE_GROUP_COLUMNS) as TnmStageGroupRow[];
    return rows[0];
  },
};

// ── ECOGPerformanceStatus ─────────────────────────────────────────────

export const ecogRepo = {
  async listForPatient(
    clinicId: string,
    patientId: string,
  ): Promise<EcogPerformanceStatusRow[]> {
    return db<EcogPerformanceStatusRow>('ecog_performance_status')
      .where({ clinic_id: clinicId, patient_id: patientId })
      .orderBy('assessed_at', 'desc');
  },

  async create(
    clinicId: string,
    staffId: string,
    dto: {
      patientId: string;
      score: number;
      assessedAt: string;
      notes?: string;
    },
  ): Promise<EcogPerformanceStatusRow> {
    const rows = await db<EcogPerformanceStatusRow>('ecog_performance_status')
      .insert({
        clinic_id: clinicId,
        patient_id: dto.patientId,
        score: dto.score,
        assessed_at: dto.assessedAt,
        assessed_by_staff_id: staffId,
        notes: dto.notes ?? null,
      })
      .returning(ECOG_COLUMNS) as EcogPerformanceStatusRow[];
    return rows[0];
  },
};

// ── CancerTreatmentPlan ───────────────────────────────────────────────

export const treatmentPlanRepo = {
  async listForCondition(
    clinicId: string,
    conditionId: string,
  ): Promise<CancerTreatmentPlanRow[]> {
    return db<CancerTreatmentPlanRow>('cancer_treatment_plans')
      .where({ clinic_id: clinicId, condition_id: conditionId })
      .whereNull('deleted_at')
      .orderBy('start_date', 'desc');
  },

  async findById(
    clinicId: string,
    id: string,
  ): Promise<CancerTreatmentPlanRow | null> {
    const row = await db<CancerTreatmentPlanRow>('cancer_treatment_plans')
      .where({ clinic_id: clinicId, id })
      .whereNull('deleted_at')
      .first();
    return row ?? null;
  },

  async create(
    clinicId: string,
    staffId: string,
    dto: {
      conditionId: string;
      regimenName: string;
      intent: string;
      protocolRef?: string;
      startDate: string;
      endDate?: string;
      notes?: string;
    },
  ): Promise<CancerTreatmentPlanRow> {
    const rows = await db<CancerTreatmentPlanRow>('cancer_treatment_plans')
      .insert({
        clinic_id: clinicId,
        condition_id: dto.conditionId,
        regimen_name: dto.regimenName,
        intent: dto.intent,
        protocol_ref: dto.protocolRef ?? null,
        start_date: dto.startDate,
        end_date: dto.endDate ?? null,
        status: 'active',
        notes: dto.notes ?? null,
        created_by_staff_id: staffId,
      })
      .returning(CANCER_TREATMENT_PLAN_COLUMNS) as CancerTreatmentPlanRow[];
    return rows[0];
  },
};

// ── ChemoCycle ────────────────────────────────────────────────────────

export const chemoCycleRepo = {
  async listForPlan(
    clinicId: string,
    planId: string,
  ): Promise<ChemoCycleRow[]> {
    return db<ChemoCycleRow>('chemo_cycles')
      .where({ clinic_id: clinicId, plan_id: planId })
      .orderBy('cycle_number', 'asc');
  },

  async create(
    clinicId: string,
    staffId: string,
    dto: {
      planId: string;
      cycleNumber: number;
      plannedDate: string;
      actualDate?: string;
      status?: string;
      doseModifications?: Record<string, unknown>;
      toxicityCtcae?: Record<string, unknown>;
      notes?: string;
    },
  ): Promise<ChemoCycleRow> {
    const rows = await db<ChemoCycleRow>('chemo_cycles')
      .insert({
        clinic_id: clinicId,
        plan_id: dto.planId,
        cycle_number: dto.cycleNumber,
        planned_date: dto.plannedDate,
        actual_date: dto.actualDate ?? null,
        status: dto.status ?? 'planned',
        dose_modifications: JSON.stringify(dto.doseModifications ?? {}),
        toxicity_ctcae: JSON.stringify(dto.toxicityCtcae ?? {}),
        notes: dto.notes ?? null,
        administered_by_staff_id: dto.actualDate ? staffId : null,
      })
      .returning(CHEMO_CYCLE_COLUMNS) as ChemoCycleRow[];
    return rows[0];
  },
};

// ── TumourBoardDecision ───────────────────────────────────────────────

export const tumourBoardRepo = {
  async listForCondition(
    clinicId: string,
    conditionId: string,
  ): Promise<TumourBoardDecisionRow[]> {
    return db<TumourBoardDecisionRow>('tumour_board_decisions')
      .where({ clinic_id: clinicId, condition_id: conditionId })
      .orderBy('meeting_date', 'desc');
  },

  async create(
    clinicId: string,
    staffId: string,
    dto: {
      conditionId: string;
      meetingDate: string;
      recommendation: string;
      rationale?: string;
      attendeeStaffIds?: string[];
    },
  ): Promise<TumourBoardDecisionRow> {
    const rows = await db<TumourBoardDecisionRow>('tumour_board_decisions')
      .insert({
        clinic_id: clinicId,
        condition_id: dto.conditionId,
        meeting_date: dto.meetingDate,
        recommendation: dto.recommendation,
        rationale: dto.rationale ?? null,
        attendee_staff_ids: dto.attendeeStaffIds ?? null,
        chaired_by_staff_id: staffId,
      })
      .returning(TUMOUR_BOARD_DECISION_COLUMNS) as TumourBoardDecisionRow[];
    return rows[0];
  },
};

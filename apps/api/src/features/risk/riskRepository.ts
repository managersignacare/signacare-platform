// apps/api/src/features/risk/riskRepository.ts
import { db } from '../../db/db';
import type { RiskAssessmentCreateDTO } from '@signacare/shared';
import type { Knex } from 'knex';

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// Verified: risk_assessments has 26 columns. Includes interpretation_detail
// which the create path does not write (defaults to null) but is included
// in the return shape for consumers that may read it later.
const RISK_ASSESSMENT_COLUMNS = [
  'id',
  'clinic_id',
  'patient_id',
  'episode_id',
  'template_submission_id',
  'assessment_type',
  'total_score',
  'score_band',
  'interpretation_detail',
  'overall_risk_level',
  'suicide_risk',
  'self_harm_risk',
  'harm_to_others_risk',
  'absconding_risk',
  'vulnerability_risk',
  'protective_factors',
  'risk_narrative',
  'risk_management_plan',
  'safety_plan_in_place',
  'safety_plan_summary',
  'assessed_by_id',
  'assessment_date',
  'review_date',
  'created_at',
  'updated_at',
  'deleted_at',
  // BUG-564 — opt-locking version. Required by `updateWithOptimisticLock`
  // helper for any future UPDATE path. AHPRA Standard 1 forensic
  // protection against silent overwrite of suicide_risk /
  // overall_risk_level during multi-clinician MDT review.
  'lock_version',
] as const;

/**
 * @schema-drift-exempt select-aliased
 * `assessor_name` is populated by a SELECT CONCAT(s.given_name, ' ', s.family_name)
 * alias on the join with `staff`, not a column on `risk_assessments`. Guard-exempt.
 */
export interface RiskAssessmentRow {
  id:                    string;
  clinic_id:             string;
  patient_id:            string;
  episode_id:            string | null;
  template_submission_id: string | null;
  assessment_type:       string;
  total_score:           string | null;
  score_band:            string | null;
  overall_risk_level:    string;
  suicide_risk:          boolean;
  self_harm_risk:        boolean;
  harm_to_others_risk:   boolean;
  absconding_risk:       boolean;
  vulnerability_risk:    boolean;
  protective_factors:    string | null;
  risk_narrative:        string | null;
  risk_management_plan:  string | null;
  safety_plan_in_place:  boolean;
  safety_plan_summary:   string | null;
  assessed_by_id:         string;
  assessment_date:       string;
  review_date:           string | null;
  created_at:            string;
  updated_at:            string;
  deleted_at:            string | null;
  // BUG-564 — opt-locking version (default 1; monotonic). Future UPDATE
  // paths MUST route through `updateWithOptimisticLock` per CLAUDE.md §1.6.
  lock_version:          number;
  assessor_name?:        string;
}

export const riskRepository = {
  async create(
    clinicId: string,
    staffId: string,
    dto: RiskAssessmentCreateDTO,
    trx?: Knex.Transaction,
  ): Promise<RiskAssessmentRow> {
    const q = (trx ?? db)('risk_assessments').insert({
      clinic_id:             clinicId,
      patient_id:            dto.patientId,
      episode_id:            dto.episodeId ?? null,
      template_submission_id: dto.templateInstanceId ?? null,
      assessment_type:       dto.assessmentType,
      total_score:           dto.totalScore ?? null,
      score_band:            dto.scoreBand ?? null,
      overall_risk_level:    dto.overallRiskLevel,
      suicide_risk:          dto.suicideRisk,
      self_harm_risk:        dto.selfHarmRisk,
      harm_to_others_risk:   dto.harmToOthersRisk,
      absconding_risk:       dto.abscondingRisk,
      vulnerability_risk:    dto.vulnerabilityRisk,
      protective_factors:    dto.protectiveFactors ?? null,
      risk_narrative:        dto.riskNarrative ?? null,
      risk_management_plan:  dto.riskManagementPlan ?? null,
      safety_plan_in_place:  dto.safetyPlanInPlace,
      safety_plan_summary:   dto.safetyPlanSummary ?? null,
      assessed_by_id:         staffId,
      assessment_date:       dto.assessmentDate,
      review_date:           dto.reviewDate ?? null,
      created_at:            new Date(),
      updated_at:            new Date(),
    }).returning(RISK_ASSESSMENT_COLUMNS);
    const [row] = await q;
    return row as RiskAssessmentRow;
  },

  async listForPatient(clinicId: string, patientId: string): Promise<RiskAssessmentRow[]> {
    const rows = await db('risk_assessments as r')
      .leftJoin('staff as s', 's.id', 'r.assessed_by_id')
      .where('r.clinic_id', clinicId)
      .andWhere('r.patient_id', patientId)
      .whereNull('r.deleted_at')
      .select(
        'r.*',
        db.raw(`concat(coalesce(s.given_name, ''), ' ', coalesce(s.family_name, '')) as assessor_name`),
      )
      .orderBy('r.assessment_date', 'desc');
    return rows as RiskAssessmentRow[];
  },

  async findById(clinicId: string, id: string): Promise<RiskAssessmentRow | undefined> {
    const row = await db('risk_assessments as r')
      .leftJoin('staff as s', 's.id', 'r.assessed_by_id')
      .where('r.clinic_id', clinicId)
      .andWhere('r.id', id)
      .whereNull('r.deleted_at')
      .select(
        'r.*',
        db.raw(`concat(coalesce(s.given_name, ''), ' ', coalesce(s.family_name, '')) as assessor_name`),
      )
      .first();
    return row as RiskAssessmentRow | undefined;
  },

  async softDelete(clinicId: string, id: string): Promise<void> {
    await db('risk_assessments')
      .where('clinic_id', clinicId)
      .andWhere('id', id)
      .whereNull('deleted_at')
      .update({ deleted_at: new Date(), updated_at: new Date() });
  },
};

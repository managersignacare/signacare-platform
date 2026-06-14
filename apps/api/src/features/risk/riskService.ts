// apps/api/src/features/risk/riskService.ts
//
// Audit Tier 3.1 (HIGH-D1) — service-layer AuthContext migration per
// CLAUDE.md §13. Every public method accepts AuthContext as the first
// parameter and enforces requirePermission + requirePatientRelationship
// at the service boundary. Defense-in-depth: even an internal caller
// that bypassed HTTP middleware cannot read or mutate risk data for a
// patient the clinician is not caring for.
//
// Break-glass sessions (auth.breakGlassSessionId) short-circuit the
// relationship check per requirePatientRelationship's documented
// bypass — emergency access is audited via the break-glass session
// trail instead.
import type { AuthContext } from '@signacare/shared';
import {
  RiskAssessmentCreateDTO,
  RiskAssessmentResponse,
  RiskAssessmentResponseSchema,
} from '@signacare/shared';
import { riskRepository } from './riskRepository';
import { AppError } from '../../shared/errors';
import { parseRow } from '../../shared/coerceRow';
import {
  requirePermission,
  requirePatientReadAccess,
  requirePatientRelationship,
} from '../../shared/authGuards';

function mapRowToResponse(row: Record<string, unknown>): RiskAssessmentResponse {
  const obj: Record<string, unknown> = {
    id:                  row['id'],
    clinicId:            row['clinic_id'],
    patientId:           row['patient_id'],
    episodeId:           row['episode_id'] ?? undefined,
    templateInstanceId:  row['template_submission_id'] ?? undefined,
    assessmentType:      row['assessment_type'],
    totalScore:          row['total_score'] != null ? Number(row['total_score']) : undefined,
    scoreBand:           row['score_band'] ?? undefined,
    overallRiskLevel:    row['overall_risk_level'],
    suicideRisk:         row['suicide_risk'],
    selfHarmRisk:        row['self_harm_risk'],
    harmToOthersRisk:    row['harm_to_others_risk'],
    abscondingRisk:      row['absconding_risk'],
    vulnerabilityRisk:   row['vulnerability_risk'],
    protectiveFactors:   row['protective_factors'] ?? undefined,
    riskNarrative:       row['risk_narrative'] ?? undefined,
    riskManagementPlan:  row['risk_management_plan'] ?? undefined,
    safetyPlanInPlace:   row['safety_plan_in_place'],
    safetyPlanSummary:   row['safety_plan_summary'] ?? undefined,
    assessedByStaffId:   row['assessed_by_id'],
    assessorName:        row['assessor_name'] ?? undefined,
    assessmentDate:      row['assessment_date'] instanceof Date
      ? row['assessment_date'].toISOString().slice(0, 10)
      : row['assessment_date'],
    reviewDate:          row['review_date'] instanceof Date
      ? row['review_date'].toISOString().slice(0, 10)
      : (row['review_date'] ?? undefined),
    createdAt:           row['created_at'],
    updatedAt:           row['updated_at'],
    // BUG-564 — surface opt-lock version so future UPDATE callers echo it back.
    lockVersion:         row['lock_version'],
  };
  return parseRow(obj, RiskAssessmentResponseSchema);
}

export const riskService = {
  async create(
    auth: AuthContext,
    dto: RiskAssessmentCreateDTO,
  ): Promise<RiskAssessmentResponse> {
    requirePermission(auth, 'risk:create');
    await requirePatientRelationship(auth, dto.patientId);
    const row = await riskRepository.create(auth.clinicId, auth.staffId, dto);
    return mapRowToResponse(row as unknown as Record<string, unknown>);
  },

  async listForPatient(
    auth: AuthContext,
    patientId: string,
  ): Promise<RiskAssessmentResponse[]> {
    requirePermission(auth, 'risk:read');
    await requirePatientReadAccess(auth, patientId);
    const rows = await riskRepository.listForPatient(auth.clinicId, patientId);
    return rows.map((r) => mapRowToResponse(r as unknown as Record<string, unknown>));
  },

  async getById(
    auth: AuthContext,
    id: string,
  ): Promise<RiskAssessmentResponse> {
    requirePermission(auth, 'risk:read');
    const row = await riskRepository.findById(auth.clinicId, id);
    if (!row) throw new AppError('Risk assessment not found', 404, 'NOT_FOUND');
    await requirePatientReadAccess(auth, (row as { patient_id: string }).patient_id);
    return mapRowToResponse(row as unknown as Record<string, unknown>);
  },

  async softDelete(auth: AuthContext, id: string): Promise<void> {
    requirePermission(auth, 'risk:delete');
    const row = await riskRepository.findById(auth.clinicId, id);
    if (!row) throw new AppError('Risk assessment not found', 404, 'NOT_FOUND');
    await requirePatientRelationship(auth, (row as { patient_id: string }).patient_id);
    await riskRepository.softDelete(auth.clinicId, id);
  },
};

// apps/api/src/features/clinical-review/clinicalReview.service.ts
import { randomUUID } from 'crypto';
import type {
  ConsultationResponse,
  EngagementScoreResponse,
  KeyIssueResponse,
  ReviewPlanResponse,
  EncounterTimelineEntryResponse,
  ClinicalReviewSummaryResponse,
  DiagnosisResponse,
  SaveEngagementScoreDTO,
  SaveKeyIssuesDTO,
  SaveReviewPlanDTO,
} from '@signacare/shared';
import { clinicalReviewRepository } from './clinicalReviewRepository';
import type { ConsultationRow, EngagementScoreRow, KeyIssueRow, DiagnosisRow } from './clinicalReviewRepository';
import { writeAuditLog } from '../../utils/audit';
import { AppError } from '../../shared/errors';
import type { AuthContext } from '@signacare/shared';

// Cross-slice service imports (aggregation for summary endpoint)
import { flagService } from '../flags/flagService';
import { riskService } from '../risk/riskService';

// ── Row-to-response mappers ───────────────────────────────────────────────────
function mapDiagnosisRow(row: DiagnosisRow): DiagnosisResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    episodeId: row.episode_id,
    createdById: row.created_by_id,
    icdCode: row.icd_code,
    description: row.description,
    diagnosedDate: row.diagnosed_date,
    status: row.status as DiagnosisResponse['status'],
    isPrimary: row.is_primary,
    diagnosedByName: row.createdbyname ?? undefined,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapEngagementRow(row: EngagementScoreRow): EngagementScoreResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    encounterId: row.encounter_id,
    patientId: row.patient_id,
    rapport: row.rapport,
    engagement: row.engagement,
    compliance: row.compliance,
    insight: row.insight,
    affect: row.affect,
    notes: row.notes,
    recordedAt: row.recorded_at.toISOString(),
  };
}

function mapKeyIssueRow(row: KeyIssueRow): KeyIssueResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    encounterId: row.encounter_id,
    patientId: row.patient_id,
    issueText: row.issue_text,
    category: row.category as KeyIssueResponse['category'],
    priority: row.priority as KeyIssueResponse['priority'],
    resolution: row.resolution,
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapConsultationRow(
  row: ConsultationRow,
  engagementScore: EngagementScoreResponse | null,
  keyIssues: KeyIssueResponse[],
): ConsultationResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    episodeId: row.episode_id,
    encounterDate: row.encounter_date.toISOString(),
    encounterType: row.encounter_type as ConsultationResponse['encounterType'],
    clinicianId: row.clinician_id,
    clinicianName: row.clinicianname ?? '',
    durationMinutes: row.duration_minutes,
    presentingComplaints: row.presenting_complaints,
    mse: (row.mse as ConsultationResponse['mse']) ?? null,
    engagementScore,
    keyIssues,
    planText: row.plan_text,
    noteId: row.note_id,
    status: row.status as ConsultationResponse['status'],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapEncounterTimelineRow(row: ConsultationRow): EncounterTimelineEntryResponse {
  return {
    id: row.id,
    encounterId: row.id,
    encounterType: row.encounter_type as EncounterTimelineEntryResponse['encounterType'],
    encounterDate: row.encounter_date.toISOString(),
    clinicianName: row.clinicianname ?? '',
    summary: row.presenting_complaints
      ? row.presenting_complaints.slice(0, 120)
      : row.plan_text
      ? row.plan_text.slice(0, 120)
      : null,
    episodeId: row.episode_id,
    hasNote: Boolean(row.note_id),
    noteId: row.note_id,
    durationMinutes: row.duration_minutes,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────
export const clinicalReviewService = {
  // ── Aggregate clinical review summary ─────────────────────────────────────
  async getClinicalReviewSummary(
    auth: AuthContext,
    patientId: string,
    episodeId?: string,
  ): Promise<ClinicalReviewSummaryResponse> {
    const { clinicId, staffId: actorId } = auth;
    const flags = await flagService.listHighSeverityForPatient(clinicId, patientId);
    const diagnoses = await clinicalReviewRepository.findDiagnosesForPatient(clinicId, patientId, episodeId);
    const riskHistory = await riskService.listForPatient(auth, patientId);
    const timeline = await clinicalReviewRepository.listConsultationsForPatient(clinicId, patientId, 50, 0);
    const activeMHActOrders: unknown[] = [];

    // lastReviewDate = most recent consultation's encounterdate
    const lastReviewDate =
      timeline.length > 0 ? timeline[0].encounter_date.toISOString() : null;

    await writeAuditLog({ clinicId, actorId,
      action: 'READ',
      tableName: 'clinical_review_summary',
      recordId: patientId,
    });

    return {
      patientId,
      episodeId: episodeId ?? null,
      flags,
      diagnoses: diagnoses.map(mapDiagnosisRow),
      // Medications and LAI: sourced from medications slice — empty arrays here
      // until medications backend is wired; replace with real imports when available
      currentMedications: [],
      laiSchedules: [],
      riskHistory,
      activeMHActOrders,
      encounterTimeline: timeline.map(mapEncounterTimelineRow),
      lastReviewDate,
      generatedAt: new Date().toISOString(),
    };
  },

  // ── Encounter timeline (paginated) ────────────────────────────────────────
  async getEncounterTimeline(
    clinicId: string,
    patientId: string,
    actorId: string,
    limit: number,
    offset: number,
  ): Promise<EncounterTimelineEntryResponse[]> {
    const rows = await clinicalReviewRepository.listConsultationsForPatient(
      clinicId,
      patientId,
      limit,
      offset,
    );

    await writeAuditLog({ clinicId, actorId,
      action: 'READ',
      tableName: 'consultations',
      recordId: patientId,
    });

    return rows.map(mapEncounterTimelineRow);
  },

  // ── Get single consultation ───────────────────────────────────────────────
  async getConsultation(
    clinicId: string,
    encounterId: string,
    actorId: string,
  ): Promise<ConsultationResponse> {
    const row = await clinicalReviewRepository.findConsultationById(clinicId, encounterId);
    if (!row) {
      throw new AppError('Consultation not found', 404, 'NOT_FOUND');
    }

    const engagementRow = await clinicalReviewRepository.findEngagementScore(clinicId, encounterId);
    const keyIssueRows = await clinicalReviewRepository.findKeyIssues(clinicId, encounterId);

    await writeAuditLog({ clinicId, actorId,
      action: 'READ',
      tableName: 'consultations',
      recordId: encounterId,
    });

    return mapConsultationRow(
      row,
      engagementRow ? mapEngagementRow(engagementRow) : null,
      keyIssueRows.map(mapKeyIssueRow),
    );
  },

  // ── Save engagement score (upsert) ────────────────────────────────────────
  async saveEngagementScore(
    clinicId: string,
    encounterId: string,
    actorId: string,
    dto: SaveEngagementScoreDTO,
  ): Promise<EngagementScoreResponse> {
    const consultation = await clinicalReviewRepository.findConsultationById(clinicId, encounterId);
    if (!consultation) {
      throw new AppError('Consultation not found', 404, 'NOT_FOUND');
    }

    const row = await clinicalReviewRepository.upsertEngagementScore(clinicId, encounterId, dto);

    await writeAuditLog({ clinicId, actorId,
      action: 'CREATE',
      tableName: 'engagement_scores',
      recordId: row.id,
    });

    return mapEngagementRow(row);
  },

  // ── Save key issues (full replace) ────────────────────────────────────────
  async saveKeyIssues(
    clinicId: string,
    encounterId: string,
    actorId: string,
    dto: SaveKeyIssuesDTO,
  ): Promise<KeyIssueResponse[]> {
    const consultation = await clinicalReviewRepository.findConsultationById(clinicId, encounterId);
    if (!consultation) {
      throw new AppError('Consultation not found', 404, 'NOT_FOUND');
    }

    const rows = await clinicalReviewRepository.replaceKeyIssues(clinicId, encounterId, dto);

    await writeAuditLog({ clinicId, actorId,
      action: 'UPDATE',
      tableName: 'key_issues',
      recordId: encounterId,
    });

    return rows.map(mapKeyIssueRow);
  },

  // ── Save review plan ──────────────────────────────────────────────────────
  async saveReviewPlan(
    clinicId: string,
    encounterId: string,
    actorId: string,
    dto: SaveReviewPlanDTO,
  ): Promise<ReviewPlanResponse> {
    const consultation = await clinicalReviewRepository.findConsultationById(clinicId, encounterId);
    if (!consultation) {
      throw new AppError('Consultation not found', 404, 'NOT_FOUND');
    }

    // Task creation: in a full implementation this would enqueue to a task service.
    // We count the tasks to create and record here; wire to task service when available.
    const tasksCreated = dto.tasksToCreate?.length ?? 0;

    // Letter job: in a full implementation this would enqueue a letter generation job.
    // Stub returns a new UUID as the job ID when generateLetter is true.
    const letterJobId = dto.generateLetter ? randomUUID() : null;

    const planRow = await clinicalReviewRepository.createReviewPlan(
      clinicId,
      encounterId,
      dto,
      tasksCreated,
      letterJobId,
    );

    // Timeline entry ID = the review plan's own id (each plan saves is a timeline event)
    await writeAuditLog({ clinicId, actorId,
      action: 'CREATE',
      tableName: 'review_plans',
      recordId: planRow.id,
    });

    return {
      success: true,
      planId: planRow.id,
      tasksCreated,
      letterJobId,
      timelineEntryId: encounterId,
    };
  },
};

// apps/api/src/features/clinical-review/clinicalReview.repository.ts
import { randomUUID } from 'crypto';
import { db } from '../../db/db';
import type {
  CreateConsultationDTO,
  UpdateConsultationDTO,
  SaveEngagementScoreDTO,
  KeyIssueInput,
  SaveReviewPlanDTO,
  CreateDiagnosisDTO,
} from '@signacare/shared';
import { assertMseCompletenessOnSign } from './mseCompletenessGate';

// ── Row types ─────────────────────────────────────────────────────────────────
/**
 * @schema-drift-exempt select-aliased
 * `clinicianname` is populated by a SELECT CONCAT(staff.given_name, ...) alias
 * on the join with `staff`, not a column on `consultations`. Guard-exempt.
 */
export interface ConsultationRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string | null;
  clinician_id: string;
  encounter_date: Date;
  encounter_type: string;
  duration_minutes: number | null;
  presenting_complaints: string | null;
  mse: unknown;
  plan_text: string | null;
  note_id: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  // joined
  clinicianname?: string;
}

export interface EngagementScoreRow {
  id: string;
  clinic_id: string;
  encounter_id: string;
  patient_id: string;
  rapport: number;
  engagement: number;
  compliance: number;
  insight: number;
  affect: number;
  notes: string | null;
  recorded_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface KeyIssueRow {
  id: string;
  clinic_id: string;
  encounter_id: string;
  patient_id: string;
  issue_text: string;
  category: string;
  priority: string;
  resolution: string | null;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface ReviewPlanRow {
  id: string;
  clinic_id: string;
  encounter_id: string;
  patient_id: string;
  episode_id: string | null;
  plan_text: string;
  follow_up_date: string | null;
  follow_up_type: string | null;
  tasks_to_create: unknown;
  generate_letter: boolean;
  letter_type: string | null;
  letter_recipient: string | null;
  letter_job_id: string | null;
  tasks_created: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

/**
 * @schema-drift-exempt select-aliased
 * `createdbyname` is populated by a SELECT CONCAT(staff.given_name, ...) alias
 * on the join with `staff`, not a column on `diagnoses`. Guard-exempt.
 */
export interface DiagnosisRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string | null;
  created_by_id: string;
  icd_code: string;
  description: string;
  diagnosed_date: string;
  status: string;
  is_primary: boolean;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  // joined
  createdbyname?: string;
}

// Phase 0.7.5 c24 D5 — explicit .returning() column lists per table,
// matching the Row interfaces above (which match the DB snapshot). The
// select-aliased fields (clinicianname on ConsultationRow,
// createdbyname on DiagnosisRow) are NOT in these lists — they're
// populated by the joined SELECT paths, not by the INSERT returning.
const CONSULTATION_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'clinician_id',
  'encounter_date', 'encounter_type', 'duration_minutes',
  'presenting_complaints', 'mse', 'plan_text', 'note_id', 'status',
  'created_at', 'updated_at', 'deleted_at',
] as const;

const ENGAGEMENT_SCORE_COLUMNS = [
  'id', 'clinic_id', 'encounter_id', 'patient_id', 'rapport', 'engagement',
  'compliance', 'insight', 'affect', 'notes', 'recorded_at',
  'created_at', 'updated_at',
] as const;

const KEY_ISSUE_COLUMNS = [
  'id', 'clinic_id', 'encounter_id', 'patient_id', 'issue_text', 'category',
  'priority', 'resolution', 'resolved_at', 'created_at', 'updated_at',
  'deleted_at',
] as const;

const REVIEW_PLAN_COLUMNS = [
  'id', 'clinic_id', 'encounter_id', 'patient_id', 'episode_id', 'plan_text',
  'follow_up_date', 'follow_up_type', 'tasks_to_create', 'generate_letter',
  'letter_type', 'letter_recipient', 'letter_job_id', 'tasks_created',
  'created_at', 'updated_at', 'deleted_at',
] as const;

const DIAGNOSIS_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'created_by_id',
  'icd_code', 'description', 'diagnosed_date', 'status', 'is_primary',
  'notes', 'created_at', 'updated_at', 'deleted_at',
] as const;

// ── Consultation ──────────────────────────────────────────────────────────────
export const clinicalReviewRepository = {
  // ── Consultations ─────────────────────────────────────────────────────────
  async createConsultation(
    clinicId: string,
    clinicianId: string,
    dto: CreateConsultationDTO,
  ): Promise<ConsultationRow> {
    // BUG-377 (2026-05-03) — MSE completeness gate at the repository
    // boundary. Fires when a consultation is created directly with
    // status='signed' (rare; typical flow is draft → updateConsultation
    // with status='signed'). Both call sites are gated.
    assertMseCompletenessOnSign(dto.mse ?? null, dto.status ?? 'draft');
    const rows = await db<ConsultationRow>('consultations')
      .insert({
        id: randomUUID(),
        clinic_id: clinicId,
        patient_id: dto.patientId,
        episode_id: dto.episodeId ?? null,
        clinician_id: clinicianId,
        encounter_date: new Date(dto.encounterDate),
        encounter_type: dto.encounterType ?? 'consultation',
        duration_minutes: dto.durationMinutes ?? null,
        presenting_complaints: dto.presentingComplaints ?? null,
        mse: dto.mse ? JSON.stringify(dto.mse) : null,
        plan_text: dto.planText ?? null,
        note_id: dto.noteId ?? null,
        status: dto.status ?? 'draft',
      })
      .returning(CONSULTATION_COLUMNS) as ConsultationRow[];
    return rows[0];
  },

  async findConsultationById(
    clinicId: string,
    id: string,
  ): Promise<ConsultationRow | undefined> {
    return db<ConsultationRow>('consultations as c')
      .leftJoin('staff', 'staff.id', 'c.clinician_id')
      .where({ 'c.clinic_id': clinicId, 'c.id': id })
      .whereNull('c.deleted_at')
      .select('c.*', db.raw("CONCAT(staff.given_name, ' ', staff.family_name) AS clinician_name"))
      .first();
  },

  async listConsultationsForPatient(
    clinicId: string,
    patientId: string,
    limit = 50,
    offset = 0,
  ): Promise<ConsultationRow[]> {
    return db<ConsultationRow>('consultations as c')
      .leftJoin('staff', 'staff.id', 'c.clinician_id')
      .where({ 'c.clinic_id': clinicId, 'c.patient_id': patientId })
      .whereNull('c.deleted_at')
      .orderBy('c.encounter_date', 'desc')
      .limit(limit)
      .offset(offset)
      .select('c.*', db.raw("CONCAT(staff.given_name, ' ', staff.family_name) AS clinician_name"));
  },

  async updateConsultation(
    clinicId: string,
    id: string,
    dto: UpdateConsultationDTO,
  ): Promise<ConsultationRow | undefined> {
    // BUG-377 (2026-05-03) — MSE completeness gate. Fires when this
    // update transitions status to 'signed'. Reads the existing row to
    // determine the FINAL mse (caller's update OR previously-saved
    // value) so the gate sees what will actually persist.
    if (dto.status === 'signed') {
      const existing = await db<ConsultationRow>('consultations')
        .where({ clinic_id: clinicId, id })
        .whereNull('deleted_at')
        .first();
      // Decide the FINAL mse: caller's mse takes precedence, otherwise
      // existing row's mse is preserved (which JSON-parses from string).
      let finalMse: import('@signacare/shared').MentalStateExam | null = null;
      if (dto.mse !== undefined) {
        finalMse = dto.mse;
      } else if (existing?.mse) {
        try {
          finalMse = typeof existing.mse === 'string'
            ? JSON.parse(existing.mse)
            : (existing.mse as import('@signacare/shared').MentalStateExam);
        } catch {
          finalMse = null;
        }
      }
      assertMseCompletenessOnSign(finalMse, 'signed');
    }
    const rows = await db<ConsultationRow>('consultations')
      .where({ clinic_id: clinicId, id })
      .whereNull('deleted_at')
      .update({
        ...(dto.encounterDate !== undefined && { encounter_date: new Date(dto.encounterDate) }),
        ...(dto.encounterType !== undefined && { encounter_type: dto.encounterType }),
        ...(dto.durationMinutes !== undefined && { duration_minutes: dto.durationMinutes }),
        ...(dto.presentingComplaints !== undefined && { presenting_complaints: dto.presentingComplaints }),
        ...(dto.mse !== undefined && { mse: dto.mse ? JSON.stringify(dto.mse) : null }),
        ...(dto.planText !== undefined && { plan_text: dto.planText }),
        ...(dto.noteId !== undefined && { note_id: dto.noteId }),
        ...(dto.status !== undefined && { status: dto.status }),
        updated_at: new Date(),
      })
      .returning(CONSULTATION_COLUMNS) as ConsultationRow[];
    return rows[0];
  },

  // ── Engagement Scores ─────────────────────────────────────────────────────
  async upsertEngagementScore(
    clinicId: string,
    encounterId: string,
    dto: SaveEngagementScoreDTO,
  ): Promise<EngagementScoreRow> {
    const existing = await db<EngagementScoreRow>('engagement_scores')
      .where({ clinic_id: clinicId, encounter_id: encounterId })
      .first();

    if (existing) {
      const rows = await db<EngagementScoreRow>('engagement_scores')
        .where({ clinic_id: clinicId, encounter_id: encounterId })
        .update({
          rapport: dto.rapport,
          engagement: dto.engagement,
          compliance: dto.compliance,
          insight: dto.insight,
          affect: dto.affect,
          notes: dto.notes ?? null,
          recorded_at: new Date(),
          updated_at: new Date(),
        })
        .returning(ENGAGEMENT_SCORE_COLUMNS) as EngagementScoreRow[];
      return rows[0];
    }

    const rows = await db<EngagementScoreRow>('engagement_scores')
      .insert({
        id: randomUUID(),
        clinic_id: clinicId,
        encounter_id: encounterId,
        patient_id: dto.patientId,
        rapport: dto.rapport,
        engagement: dto.engagement,
        compliance: dto.compliance,
        insight: dto.insight,
        affect: dto.affect,
        notes: dto.notes ?? null,
        recorded_at: new Date(),
      })
      .returning(ENGAGEMENT_SCORE_COLUMNS) as EngagementScoreRow[];
    return rows[0];
  },

  async findEngagementScore(
    clinicId: string,
    encounterId: string,
  ): Promise<EngagementScoreRow | undefined> {
    return db<EngagementScoreRow>('engagement_scores')
      .where({ clinic_id: clinicId, encounter_id: encounterId })
      .first();
  },

  // ── Key Issues ────────────────────────────────────────────────────────────
  async replaceKeyIssues(
    clinicId: string,
    encounterId: string,
    issues: KeyIssueInput[],
  ): Promise<KeyIssueRow[]> {
    return db.transaction(async (trx) => {
      // Soft-delete existing
      await trx<KeyIssueRow>('key_issues')
        .where({ clinic_id: clinicId, encounter_id: encounterId })
        .whereNull('deleted_at')
        .update({ deleted_at: new Date(), updated_at: new Date() });

      if (issues.length === 0) return [];

      const rows = issues.map((issue) => ({
        id: randomUUID(),
        clinic_id: clinicId,
        encounter_id: encounterId,
        patient_id: issue.patientId,
        issue_text: issue.issueText,
        category: issue.category,
        priority: issue.priority,
        resolution: issue.resolution ?? null,
        resolved_at: issue.resolvedAt ? new Date(issue.resolvedAt) : null,
      }));

      return trx<KeyIssueRow>('key_issues')
        .insert(rows)
        .returning(KEY_ISSUE_COLUMNS) as Promise<KeyIssueRow[]>;
    });
  },

  async findKeyIssues(
    clinicId: string,
    encounterId: string,
  ): Promise<KeyIssueRow[]> {
    return db<KeyIssueRow>('key_issues')
      .where({ clinic_id: clinicId, encounter_id: encounterId })
      .whereNull('deleted_at')
      .orderBy('created_at', 'asc');
  },

  // ── Review Plans ──────────────────────────────────────────────────────────
  async createReviewPlan(
    clinicId: string,
    encounterId: string,
    dto: SaveReviewPlanDTO,
    tasksCreated: number,
    letterJobId: string | null,
  ): Promise<ReviewPlanRow> {
    const rows = await db<ReviewPlanRow>('review_plans')
      .insert({
        id: randomUUID(),
        clinic_id: clinicId,
        encounter_id: encounterId,
        patient_id: dto.patientId,
        episode_id: dto.episodeId ?? null,
        plan_text: dto.planText,
        follow_up_date: dto.followUpDate ?? null,
        follow_up_type: dto.followUpType ?? null,
        tasks_to_create: dto.tasksToCreate ? JSON.stringify(dto.tasksToCreate) : null,
        generate_letter: dto.generateLetter,
        letter_type: dto.letterType ?? null,
        letter_recipient: dto.letterRecipient ?? null,
        letter_job_id: letterJobId,
        tasks_created: tasksCreated,
      })
      .returning(REVIEW_PLAN_COLUMNS) as ReviewPlanRow[];

    // Update consultation plantext
    await db('consultations')
      .where({ clinic_id: clinicId, id: encounterId })
      .whereNull('deleted_at')
      .update({ plan_text: dto.planText, updated_at: new Date() });

    return rows[0];
  },

  async findLatestReviewPlan(
    clinicId: string,
    encounterId: string,
  ): Promise<ReviewPlanRow | undefined> {
    return db<ReviewPlanRow>('review_plans')
      .where({ clinic_id: clinicId, encounter_id: encounterId })
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
      .first();
  },

  // ── Diagnoses ─────────────────────────────────────────────────────────────
  async createDiagnosis(
    clinicId: string,
    createdById: string,
    dto: CreateDiagnosisDTO,
  ): Promise<DiagnosisRow> {
    const rows = await db<DiagnosisRow>('diagnoses')
      .insert({
        id: randomUUID(),
        clinic_id: clinicId,
        patient_id: dto.patientId,
        episode_id: dto.episodeId ?? null,
        created_by_id: createdById,
        icd_code: dto.icdCode,
        description: dto.description,
        diagnosed_date: dto.diagnosedDate,
        status: dto.status ?? 'active',
        is_primary: dto.isPrimary ?? false,
        notes: dto.notes ?? null,
      })
      .returning(DIAGNOSIS_COLUMNS) as DiagnosisRow[];
    return rows[0];
  },

  async findDiagnosesForPatient(
    clinicId: string,
    patientId: string,
    episodeId?: string,
  ): Promise<DiagnosisRow[]> {
    const q = db<DiagnosisRow>('diagnoses as d')
      .leftJoin('staff', 'staff.id', 'd.created_by_id')
      .where({ 'd.clinic_id': clinicId, 'd.patient_id': patientId })
      .whereNull('d.deleted_at')
      .orderBy('d.diagnosed_date', 'desc')
      .select('d.*', db.raw("CONCAT(staff.given_name, ' ', staff.family_name) AS createdbyname"));

    if (episodeId) {
      void q.andWhere('d.episode_id', episodeId);
    }
    return q;
  },
};
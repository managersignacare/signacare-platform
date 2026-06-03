// packages/shared/src/schemas/clinicalReview.schemas.ts
import { z } from 'zod';

// ── Enums ─────────────────────────────────────────────────────────────────────
export const EncounterTypeSchema = z.enum([
  'consultation', 'phone', 'group', 'homevisit', 'crisis', 'review', 'mdt', 'admin',
]);
export type EncounterType = z.infer<typeof EncounterTypeSchema>;

export const ConsultationStatusSchema = z.enum(['draft', 'completed', 'signed']);
export type ConsultationStatus = z.infer<typeof ConsultationStatusSchema>;

export const DiagnosisStatusSchema = z.enum(['active', 'resolved', 'inremission', 'suspected']);
export type DiagnosisStatus = z.infer<typeof DiagnosisStatusSchema>;

export const KeyIssueCategorySchema = z.enum([
  'clinical', 'social', 'functional', 'safety', 'housing',
  'medication', 'legal', 'family', 'other',
]);
export type KeyIssueCategory = z.infer<typeof KeyIssueCategorySchema>;

export const KeyIssuePrioritySchema = z.enum(['routine', 'urgent', 'critical']);
export type KeyIssuePriority = z.infer<typeof KeyIssuePrioritySchema>;

export const ReviewPlanFollowUpTypeSchema = z.enum([
  'review', 'phone', 'group', 'homevisit', 'discharge',
]);
export type ReviewPlanFollowUpType = z.infer<typeof ReviewPlanFollowUpTypeSchema>;

export const ReviewPlanLetterTypeSchema = z.enum([
  'gpupdate', 'discharge', 'referral', 'topatient', 'tocarer',
]);
export type ReviewPlanLetterType = z.infer<typeof ReviewPlanLetterTypeSchema>;

export const ReviewPlanTaskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
export type ReviewPlanTaskPriority = z.infer<typeof ReviewPlanTaskPrioritySchema>;

// ── MSE ───────────────────────────────────────────────────────────────────────
export const MentalStateExamSchema = z.object({
  appearance: z.string().nullable(),
  behaviour: z.string().nullable(),
  speech: z.string().nullable(),
  mood: z.string().nullable(),
  affect: z.string().nullable(),
  thoughtForm: z.string().nullable(),
  thoughtContent: z.string().nullable(),
  perception: z.string().nullable(),
  cognition: z.string().nullable(),
  insight: z.string().nullable(),
  judgement: z.string().nullable(),
});
export type MentalStateExam = z.infer<typeof MentalStateExamSchema>;

// ── Diagnosis DTOs ─────────────────────────────────────────────────────────────
export const CreateDiagnosisSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  icdCode: z.string().min(1).max(20),
  description: z.string().min(1).max(500),
  diagnosedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: DiagnosisStatusSchema.default('active'),
  isPrimary: z.boolean().default(false),
  notes: z.string().nullable().optional(),
});
export type CreateDiagnosisDTO = z.infer<typeof CreateDiagnosisSchema>;

export const DiagnosisResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  createdById: z.string().uuid(),
  icdCode: z.string(),
  description: z.string(),
  diagnosedDate: z.string(),
  status: DiagnosisStatusSchema,
  isPrimary: z.boolean(),
  diagnosedByName: z.string().optional(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DiagnosisResponse = z.infer<typeof DiagnosisResponseSchema>;

// ── Consultation DTOs ──────────────────────────────────────────────────────────
export const CreateConsultationSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  encounterDate: z.string().datetime(),
  encounterType: EncounterTypeSchema.default('consultation'),
  durationMinutes: z.number().int().positive().nullable().optional(),
  presentingComplaints: z.string().nullable().optional(),
  mse: MentalStateExamSchema.nullable().optional(),
  planText: z.string().nullable().optional(),
  noteId: z.string().uuid().nullable().optional(),
  status: ConsultationStatusSchema.default('draft'),
});
export type CreateConsultationDTO = z.infer<typeof CreateConsultationSchema>;

export const UpdateConsultationSchema = CreateConsultationSchema.partial().omit({ patientId: true });
export type UpdateConsultationDTO = z.infer<typeof UpdateConsultationSchema>;

// ── Engagement Score DTOs ──────────────────────────────────────────────────────
export const SaveEngagementScoreSchema = z.object({
  patientId: z.string().uuid(),
  rapport: z.number().int().min(1).max(7),
  engagement: z.number().int().min(1).max(7),
  compliance: z.number().int().min(1).max(7),
  insight: z.number().int().min(1).max(7),
  affect: z.number().int().min(1).max(7),
  notes: z.string().optional(),
});
export type SaveEngagementScoreDTO = z.infer<typeof SaveEngagementScoreSchema>;

export const EngagementScoreResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  rapport: z.number().int(),
  engagement: z.number().int(),
  compliance: z.number().int(),
  insight: z.number().int(),
  affect: z.number().int(),
  notes: z.string().nullable(),
  recordedAt: z.string().datetime(),
});
export type EngagementScoreResponse = z.infer<typeof EngagementScoreResponseSchema>;

// ── Key Issue DTOs ─────────────────────────────────────────────────────────────
export const KeyIssueInputSchema = z.object({
  patientId: z.string().uuid(),
  issueText: z.string().min(1),
  category: KeyIssueCategorySchema,
  priority: KeyIssuePrioritySchema,
  resolution: z.string().optional(),
  resolvedAt: z.string().datetime().nullable().optional(),
});
export type KeyIssueInput = z.infer<typeof KeyIssueInputSchema>;

export const SaveKeyIssuesSchema = z.array(KeyIssueInputSchema).min(0);
export type SaveKeyIssuesDTO = z.infer<typeof SaveKeyIssuesSchema>;

export const KeyIssueResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  issueText: z.string(),
  category: KeyIssueCategorySchema,
  priority: KeyIssuePrioritySchema,
  resolution: z.string().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type KeyIssueResponse = z.infer<typeof KeyIssueResponseSchema>;

// ── Review Plan DTOs ──────────────────────────────────────────────────────────
export const ReviewPlanTaskInputSchema = z.object({
  title: z.string().min(1),
  assignToStaffId: z.string().uuid().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priority: ReviewPlanTaskPrioritySchema,
});
export type ReviewPlanTaskInput = z.infer<typeof ReviewPlanTaskInputSchema>;

export const SaveReviewPlanSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  planText: z.string().min(1),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  followUpType: ReviewPlanFollowUpTypeSchema.optional(),
  tasksToCreate: z.array(ReviewPlanTaskInputSchema).optional(),
  generateLetter: z.boolean().default(false),
  letterType: ReviewPlanLetterTypeSchema.optional(),
  letterRecipient: z.string().optional(),
});
export type SaveReviewPlanDTO = z.infer<typeof SaveReviewPlanSchema>;

export const ReviewPlanResponseSchema = z.object({
  success: z.boolean(),
  planId: z.string().uuid(),
  tasksCreated: z.number(),
  letterJobId: z.string().uuid().nullable(),
  timelineEntryId: z.string().uuid(),
});
export type ReviewPlanResponse = z.infer<typeof ReviewPlanResponseSchema>;

// ── Consultation Full Response ─────────────────────────────────────────────────
export const ConsultationResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  encounterDate: z.string().datetime(),
  encounterType: EncounterTypeSchema,
  clinicianId: z.string().uuid(),
  clinicianName: z.string(),
  durationMinutes: z.number().nullable(),
  presentingComplaints: z.string().nullable(),
  mse: MentalStateExamSchema.nullable(),
  engagementScore: EngagementScoreResponseSchema.nullable(),
  keyIssues: z.array(KeyIssueResponseSchema),
  planText: z.string().nullable(),
  noteId: z.string().uuid().nullable(),
  status: ConsultationStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ConsultationResponse = z.infer<typeof ConsultationResponseSchema>;

// ── Encounter Timeline Entry ──────────────────────────────────────────────────
export const EncounterTimelineEntryResponseSchema = z.object({
  id: z.string().uuid(),
  encounterId: z.string().uuid(),
  encounterType: EncounterTypeSchema,
  encounterDate: z.string().datetime(),
  clinicianName: z.string(),
  summary: z.string().nullable(),
  episodeId: z.string().uuid().nullable(),
  hasNote: z.boolean(),
  noteId: z.string().uuid().nullable(),
  durationMinutes: z.number().nullable(),
});
export type EncounterTimelineEntryResponse = z.infer<typeof EncounterTimelineEntryResponseSchema>;

// ── Clinical Review Summary ───────────────────────────────────────────────────
// This is the aggregation response built by the service from multiple tables.
export const ClinicalReviewSummaryResponseSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  flags: z.array(z.unknown()),             // PatientFlagResponse[] from flags slice
  diagnoses: z.array(DiagnosisResponseSchema),
  currentMedications: z.array(z.unknown()), // MedicationResponse[] from medications slice
  laiSchedules: z.array(z.unknown()),       // LAIScheduleResponse[] from medications slice
  riskHistory: z.array(z.unknown()),        // RiskAssessmentResponse[] from risk slice
  activeMHActOrders: z.array(z.unknown()),  // reserved; MH act slice retired — always []
  encounterTimeline: z.array(EncounterTimelineEntryResponseSchema),
  lastReviewDate: z.string().datetime().nullable(),
  generatedAt: z.string().datetime(),
});
export type ClinicalReviewSummaryResponse = z.infer<typeof ClinicalReviewSummaryResponseSchema>;

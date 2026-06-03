// apps/web/src/features/clinical-review/types/reviewTypes.ts
//
// Phase 0.7 PR3 Class D — MentalStateExam + ReviewPlanResponse now come
// from @signacare/shared (both were line-for-line duplicates). Other
// local schemas (PatientFlag, Consultation, ReviewPlan, etc.) remain
// local because they're either frontend-only view shapes or awaiting
// their own per-case migration.
import { z } from 'zod';
import {
  MentalStateExamSchema,
  ReviewPlanResponseSchema,
} from '@signacare/shared';
export type { MentalStateExam, ReviewPlanResponse } from '@signacare/shared';

export const FlagSeveritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
export const FlagCategorySchema = z.enum([
  'clinical', 'risk', 'medication', 'mhact', 'lai', 'clozapine', 'safeguarding',
]);
export const RiskDomainSchema = z.enum([
  'suicide', 'selfharm', 'harmtoothers', 'absconding', 'vulnerability', 'substanceuse',
]);
export const RiskLevelSchema = z.enum(['low', 'moderate', 'high', 'veryhigh']);
export const EncounterTypeSchema = z.enum([
  'consultation', 'phone', 'group', 'homevisit', 'crisis', 'review', 'mdt', 'admin',
]);

export const PatientFlagSchema = z.object({
  id: z.string().uuid(),
  category: FlagCategorySchema,
  severity: FlagSeveritySchema,
  title: z.string(),
  description: z.string().optional(),
  raisedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  relatedRecordType: z.string().nullable(),
  relatedRecordId: z.string().uuid().nullable(),
});
export type PatientFlag = z.infer<typeof PatientFlagSchema>;

export const DiagnosisSchema = z.object({
  id: z.string().uuid(),
  icdCode: z.string(),
  description: z.string(),
  diagnosedDate: z.string(),
  status: z.enum(['active', 'resolved', 'inremission', 'suspected']),
  isPrimary: z.boolean(),
  diagnosedByName: z.string().optional(),
  notes: z.string().nullable(),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

export const CurrentMedicationSchema = z.object({
  id: z.string().uuid(),
  drugName: z.string(),
  dose: z.string(),
  route: z.string().nullable(),
  frequency: z.string(),
  startDate: z.string(),
  stopDate: z.string().nullable(),
  status: z.enum(['active', 'ceased', 'held', 'planned']),
  prescribedByName: z.string().optional(),
  isLai: z.boolean(),
  isClozapine: z.boolean(),
  notes: z.string().nullable(),
});
export type CurrentMedication = z.infer<typeof CurrentMedicationSchema>;

export const LAIScheduleSchema = z.object({
  id: z.string().uuid(),
  drugName: z.string(),
  doseGiven: z.string(),
  frequencyDays: z.number(),
  lastGivenDate: z.string().nullable(),
  nextDueDate: z.string().nullable(),
  injectionSite: z.string().nullable(),
  status: z.enum(['active', 'ceased', 'held']),
  administeredByName: z.string().optional(),
  isOverdue: z.boolean(),
  daysOverdue: z.number().nullable(),
});
export type LAISchedule = z.infer<typeof LAIScheduleSchema>;

export const RiskHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  assessmentDate: z.string(),
  riskDomain: RiskDomainSchema,
  riskLevel: RiskLevelSchema,
  historicalRisk: RiskLevelSchema.nullable(),
  keyFactors: z.string().nullable(),
  protectiveFactors: z.string().nullable(),
  clinicianName: z.string().optional(),
  notes: z.string().nullable(),
});
export type RiskHistoryEntry = z.infer<typeof RiskHistoryEntrySchema>;

export const MHActOrderSchema = z.object({
  id: z.string().uuid(),
  orderType: z.string(),
  orderNumber: z.string().nullable(),
  startDate: z.string(),
  expiryDate: z.string().nullable(),
  reviewDate: z.string().nullable(),
  status: z.enum(['active', 'expired', 'revoked', 'varied']),
  tribunal: z.string().nullable(),
  conditions: z.string().nullable(),
  daysUntilExpiry: z.number().nullable(),
});
export type MHActOrder = z.infer<typeof MHActOrderSchema>;

export const EncounterTimelineEntrySchema = z.object({
  id: z.string().uuid(),
  encounterId: z.string().uuid(),
  encounterType: EncounterTypeSchema,
  encounterDate: z.string(),
  clinicianName: z.string(),
  summary: z.string().nullable(),
  episodeId: z.string().uuid().nullable(),
  hasNote: z.boolean(),
  noteId: z.string().uuid().nullable(),
  durationMinutes: z.number().nullable(),
});
export type EncounterTimelineEntry = z.infer<typeof EncounterTimelineEntrySchema>;

export const ClinicalReviewSummarySchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  flags: z.array(PatientFlagSchema),
  diagnoses: z.array(DiagnosisSchema),
  currentMedications: z.array(CurrentMedicationSchema),
  laiSchedules: z.array(LAIScheduleSchema),
  riskHistory: z.array(RiskHistoryEntrySchema),
  activeMHActOrders: z.array(MHActOrderSchema),
  encounterTimeline: z.array(EncounterTimelineEntrySchema),
  lastReviewDate: z.string().nullable(),
  generatedAt: z.string().datetime(),
});
export type ClinicalReviewSummary = z.infer<typeof ClinicalReviewSummarySchema>;

export const EngagementRapportScoreSchema = z.object({
  id: z.string().uuid().optional(),
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  rapport: z.number().int().min(1).max(7),
  engagement: z.number().int().min(1).max(7),
  compliance: z.number().int().min(1).max(7),
  insight: z.number().int().min(1).max(7),
  affect: z.number().int().min(1).max(7),
  notes: z.string().optional(),
  recordedAt: z.string().datetime().optional(),
});
export type EngagementRapportScore = z.infer<typeof EngagementRapportScoreSchema>;

export const KeyIssueSchema = z.object({
  id: z.string().uuid().optional(),
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  issueText: z.string().min(1),
  category: z.enum([
    'clinical', 'social', 'functional', 'safety', 'housing',
    'medication', 'legal', 'family', 'other',
  ]),
  priority: z.enum(['routine', 'urgent', 'critical']),
  resolution: z.string().optional(),
  resolvedAt: z.string().datetime().nullable().optional(),
});
export type KeyIssue = z.infer<typeof KeyIssueSchema>;

// MentalStateExam schema imported from shared at the top of this file.
// Re-exported for consumers that still reference `MentalStateExamSchema`
// from this module (runtime Zod value needs an explicit export).
export { MentalStateExamSchema };

export const ConsultationSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  encounterDate: z.string(),
  encounterType: EncounterTypeSchema,
  clinicianId: z.string().uuid(),
  clinicianName: z.string(),
  durationMinutes: z.number().nullable(),
  presentingComplaints: z.string().nullable(),
  mentalStateExam: MentalStateExamSchema.nullable(),
  engagementScore: EngagementRapportScoreSchema.nullable(),
  keyIssues: z.array(KeyIssueSchema),
  planText: z.string().nullable(),
  noteId: z.string().uuid().nullable(),
  status: z.enum(['draft', 'completed', 'signed']),
  createdAt: z.string().datetime(),
});
export type Consultation = z.infer<typeof ConsultationSchema>;

export const ReviewPlanTaskSchema = z.object({
  title: z.string().min(1),
  assignToStaffId: z.string().uuid().optional(),
  dueDate: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
});
export type ReviewPlanTask = z.infer<typeof ReviewPlanTaskSchema>;

export const ReviewPlanSchema = z.object({
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  planText: z.string().min(1),
  followUpDate: z.string().optional(),
  followUpType: z.enum(['review', 'phone', 'group', 'homevisit', 'discharge']).optional(),
  tasksToCreate: z.array(ReviewPlanTaskSchema).optional(),
  generateLetter: z.boolean().default(false),
  letterType: z.enum(['gpupdate', 'discharge', 'referral', 'topatient', 'tocarer']).optional(),
  letterRecipient: z.string().optional(),
});
export type ReviewPlan = z.infer<typeof ReviewPlanSchema>;

// Phase 0.7 PR3 Class D (TYPEDUP:ReviewPlanResponse) — re-exported from
// shared. Both sides declared the same 5 fields.
export { ReviewPlanResponseSchema };

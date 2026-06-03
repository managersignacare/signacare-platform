import { z } from 'zod';

/**
 * SSoT: grace period (days) before an LAI schedule is flagged overdue.
 * Consumed by the backend (laiScheduleService — overdue flag + scheduler)
 * AND the client-side due-date count buckets, so the "overdue" definition
 * is identical on both sides and cannot drift.
 */
export const LAI_OVERDUE_GRACE_DAYS = 7;

export const LaiOutcomeEnum = z.enum(['given', 'refused', 'deferred', 'partial']);
export const LaiScheduleStatusEnum = z.enum(['active', 'paused', 'ceased']);

export const LaiScheduleCreateSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  drugProductId: z.string().uuid().optional(),
  prescriberStaffId: z.string().uuid(),
  drugName: z.string().min(1).max(200),
  doseMg: z.string().min(1).max(50),
  frequencyDays: z.number().int().positive().default(28),
  injectionSite: z.string().max(50).default('gluteal'),
  injectionTechnique: z.string().max(30).default('IM'),
  needleGauge: z.string().max(20).optional(),
  indication: z.string().optional(),
  loadingDoseRequired: z.boolean().default(false),
  loadingDosesRequired: z.number().int().min(0).default(0),
  oralOverlapRequired: z.boolean().default(false),
  oralOverlapEndDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
});
export type LaiScheduleCreateDTO = z.infer<typeof LaiScheduleCreateSchema>;

export const LaiScheduleUpdateSchema = z.object({
  doseMg: z.string().max(50).optional(),
  frequencyDays: z.number().int().positive().optional(),
  injectionSite: z.string().max(50).optional(),
  injectionTechnique: z.string().max(30).optional(),
  needleGauge: z.string().max(20).optional(),
  oralOverlapRequired: z.boolean().optional(),
  oralOverlapEndDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  nextAimsDueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  status: LaiScheduleStatusEnum.optional(),
  notes: z.string().optional(),
});
export type LaiScheduleUpdateDTO = z.infer<typeof LaiScheduleUpdateSchema>;

export const LaiScheduleResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  drugProductId: z.string().uuid().nullable(),
  prescriberStaffId: z.string().uuid(),
  drugName: z.string(),
  doseMg: z.string(),
  frequencyDays: z.number(),
  injectionSite: z.string(),
  injectionTechnique: z.string(),
  needleGauge: z.string().nullable(),
  indication: z.string().nullable(),
  loadingDoseRequired: z.boolean(),
  loadingDosesRequired: z.number(),
  loadingDosesGiven: z.number(),
  oralOverlapRequired: z.boolean(),
  oralOverlapEndDate: z.string().nullable(),
  startDate: z.string(),
  firstDueDate: z.string(),
  nextDueDate: z.string().nullable(),
  lastGivenDate: z.string().nullable(),
  endDate: z.string().nullable(),
  baselineAimsScore: z.number().nullable(),
  lastAimsDate: z.string().nullable(),
  nextAimsDueDate: z.string().nullable(),
  status: LaiScheduleStatusEnum,
  isOverdue: z.boolean(),
  daysOverdue: z.number().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LaiScheduleResponse = z.infer<typeof LaiScheduleResponseSchema>;

export const LaiGivenCreateSchema = z.object({
  laiScheduleId: z.string().uuid(),
  patientId: z.string().uuid(),
  outcome: LaiOutcomeEnum.default('given'),
  givenDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dosGivenMg: z.string().max(50).optional(),
  injectionSite: z.string().max(50).optional(),
  batchNumber: z.string().max(100).optional(),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  refusalReason: z.string().max(300).optional(),
  deferredToDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  notes: z.string().optional(),
});
export type LaiGivenCreateDTO = z.infer<typeof LaiGivenCreateSchema>;

export const LaiGivenResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  laiScheduleId: z.string().uuid(),
  patientId: z.string().uuid(),
  administeredByStaffId: z.string().uuid(),
  outcome: LaiOutcomeEnum,
  givenDate: z.string(),
  dosGivenMg: z.string().nullable(),
  injectionSite: z.string().nullable(),
  batchNumber: z.string().nullable(),
  expiryDate: z.string().nullable(),
  refusalReason: z.string().nullable(),
  deferredToDate: z.string().nullable(),
  nextDueDate: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type LaiGivenResponse = z.infer<typeof LaiGivenResponseSchema>;

export const AimsAssessmentCreateSchema = z.object({
  patientId: z.string().uuid(),
  laiScheduleId: z.string().uuid().optional(),
  assessmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  itemScores: z.record(z.string(), z.number().int().min(0).max(4)),
  totalScore: z.number().int().min(0).max(44).optional(),
  interpretation: z.string().max(100).optional(),
  globalSeverity: z.number().int().min(0).max(4).optional(),
  incapacitation: z.number().int().min(0).max(4).optional(),
  patientAwareness: z.number().int().min(0).max(4).optional(),
  currentDentalProblems: z.boolean().default(false),
  dentures: z.boolean().default(false),
  clinicalNotes: z.string().optional(),
  isBaseline: z.boolean().default(false),
});
export type AimsAssessmentCreateDTO = z.infer<typeof AimsAssessmentCreateSchema>;

export const AimsAssessmentResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  laiScheduleId: z.string().uuid().nullable(),
  assessedByStaffId: z.string().uuid(),
  assessmentDate: z.string(),
  itemScores: z.record(z.string(), z.number()),
  totalScore: z.number().nullable(),
  interpretation: z.string().nullable(),
  globalSeverity: z.number().nullable(),
  incapacitation: z.number().nullable(),
  patientAwareness: z.number().nullable(),
  currentDentalProblems: z.boolean(),
  dentures: z.boolean(),
  clinicalNotes: z.string().nullable(),
  isBaseline: z.boolean(),
  createdAt: z.string(),
});
export type AimsAssessmentResponse = z.infer<typeof AimsAssessmentResponseSchema>;
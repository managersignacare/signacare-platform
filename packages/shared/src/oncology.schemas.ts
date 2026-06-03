// packages/shared/src/oncology.schemas.ts
//
// Phase 8 — Oncology DTO schemas (mCODE-aligned).
//
// Mirrors the six clinical tables created by
// apps/api/migrations/20260504000000_oncology_phase8.ts. The naming
// follows mCODE profile names where reasonable so a future FHIR
// exporter can map 1:1 without renaming fields.

import { z } from 'zod';

export const StageSystemEnum = z.enum(['ajcc8', 'uicc8']);
export type StageSystem = z.infer<typeof StageSystemEnum>;

export const TreatmentIntentEnum = z.enum(['curative', 'palliative', 'adjuvant', 'neoadjuvant']);
export type TreatmentIntent = z.infer<typeof TreatmentIntentEnum>;

export const TreatmentPlanStatusEnum = z.enum(['draft', 'active', 'completed', 'cancelled']);
export type TreatmentPlanStatus = z.infer<typeof TreatmentPlanStatusEnum>;

export const ChemoCycleStatusEnum = z.enum(['planned', 'administered', 'delayed', 'cancelled']);
export type ChemoCycleStatus = z.infer<typeof ChemoCycleStatusEnum>;

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

// ── PrimaryCancerCondition ─────────────────────────────────────────────

export const CreatePrimaryCancerConditionSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  icd10: z.string().max(20).optional(),
  snomed: z.string().max(30).optional(),
  histology: z.string().max(200).optional(),
  laterality: z.enum(['left', 'right', 'bilateral', 'n/a']).optional(),
  diagnosisDate: DATE,
  stageSystem: StageSystemEnum.optional(),
  notes: z.string().max(4000).optional(),
});
export type CreatePrimaryCancerConditionDto = z.infer<typeof CreatePrimaryCancerConditionSchema>;

export const PrimaryCancerConditionResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  icd10: z.string().nullable(),
  snomed: z.string().nullable(),
  histology: z.string().nullable(),
  laterality: z.string().nullable(),
  diagnosisDate: z.string(),
  stageSystem: z.string().nullable(),
  notes: z.string().nullable(),
  createdByStaffId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PrimaryCancerConditionResponse = z.infer<typeof PrimaryCancerConditionResponseSchema>;

// ── TNMStageGroup ──────────────────────────────────────────────────────

export const CreateTnmStageGroupSchema = z.object({
  conditionId: z.string().uuid(),
  t: z.string().max(10).optional(),
  n: z.string().max(10).optional(),
  m: z.string().max(10).optional(),
  stageGroup: z.string().max(10).optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateTnmStageGroupDto = z.infer<typeof CreateTnmStageGroupSchema>;

export const TnmStageGroupResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  conditionId: z.string().uuid(),
  t: z.string().nullable(),
  n: z.string().nullable(),
  m: z.string().nullable(),
  stageGroup: z.string().nullable(),
  stagedAt: z.string(),
  stagedByStaffId: z.string().uuid().nullable(),
  notes: z.string().nullable(),
});
export type TnmStageGroupResponse = z.infer<typeof TnmStageGroupResponseSchema>;

// ── ECOGPerformanceStatus ──────────────────────────────────────────────

export const CreateEcogSchema = z.object({
  patientId: z.string().uuid(),
  score: z.number().int().min(0).max(5),
  assessedAt: z.string().datetime(),
  notes: z.string().max(2000).optional(),
});
export type CreateEcogDto = z.infer<typeof CreateEcogSchema>;

export const EcogResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  score: z.number().int(),
  assessedAt: z.string(),
  assessedByStaffId: z.string().uuid().nullable(),
  notes: z.string().nullable(),
});
export type EcogResponse = z.infer<typeof EcogResponseSchema>;

// ── CancerTreatmentPlan ────────────────────────────────────────────────

export const CreateTreatmentPlanSchema = z.object({
  conditionId: z.string().uuid(),
  regimenName: z.string().min(1).max(200),
  intent: TreatmentIntentEnum,
  protocolRef: z.string().max(200).optional(),
  startDate: DATE,
  endDate: DATE.optional(),
  notes: z.string().max(4000).optional(),
});
export type CreateTreatmentPlanDto = z.infer<typeof CreateTreatmentPlanSchema>;

export const TreatmentPlanResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  conditionId: z.string().uuid(),
  regimenName: z.string(),
  intent: TreatmentIntentEnum,
  protocolRef: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  status: TreatmentPlanStatusEnum,
  notes: z.string().nullable(),
  createdByStaffId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TreatmentPlanResponse = z.infer<typeof TreatmentPlanResponseSchema>;

// ── ChemoCycle ─────────────────────────────────────────────────────────

// BUG-ONC-* residual hardening: `toxicityCtcae` can no longer be an
// unbounded JSON blob. Values must be either:
// 1) a bounded legacy grade map value (`0..5`) for compatibility, or
// 2) a structured CTCAE event object with explicit grade + metadata.
// R-FIX-BUG-ONC-CTCAE-CONTRACT
export const CtcaeGradeSchema = z.number().int().min(0).max(5);
export type CtcaeGrade = z.infer<typeof CtcaeGradeSchema>;

export const CtcaeAttributionEnum = z.enum([
  'unrelated',
  'unlikely',
  'possible',
  'probable',
  'definite',
]);
export type CtcaeAttribution = z.infer<typeof CtcaeAttributionEnum>;

export const CtcaeEventSchema = z.object({
  term: z.string().min(1).max(200),
  grade: CtcaeGradeSchema,
  attribution: CtcaeAttributionEnum.optional(),
  serious: z.boolean().optional(),
  observedAt: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
}).strict();
export type CtcaeEvent = z.infer<typeof CtcaeEventSchema>;

export const CtcaeEventValueSchema = z.union([CtcaeGradeSchema, CtcaeEventSchema]);
export type CtcaeEventValue = z.infer<typeof CtcaeEventValueSchema>;

export const ToxicityCtcaeSchema = z.record(CtcaeEventValueSchema);
export type ToxicityCtcae = z.infer<typeof ToxicityCtcaeSchema>;

export const CreateChemoCycleSchema = z.object({
  planId: z.string().uuid(),
  cycleNumber: z.number().int().positive(),
  plannedDate: DATE,
  actualDate: DATE.optional(),
  status: ChemoCycleStatusEnum.optional(),
  doseModifications: z.record(z.unknown()).optional(),
  toxicityCtcae: ToxicityCtcaeSchema.optional(),
  notes: z.string().max(4000).optional(),
});
export type CreateChemoCycleDto = z.infer<typeof CreateChemoCycleSchema>;

export const ChemoCycleResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  planId: z.string().uuid(),
  cycleNumber: z.number().int(),
  plannedDate: z.string(),
  actualDate: z.string().nullable(),
  status: ChemoCycleStatusEnum,
  doseModifications: z.record(z.unknown()),
  toxicityCtcae: ToxicityCtcaeSchema,
  notes: z.string().nullable(),
  administeredByStaffId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChemoCycleResponse = z.infer<typeof ChemoCycleResponseSchema>;

// ── TumourBoardDecision ────────────────────────────────────────────────

export const CreateTumourBoardDecisionSchema = z.object({
  conditionId: z.string().uuid(),
  meetingDate: DATE,
  recommendation: z.string().min(1).max(4000),
  rationale: z.string().max(4000).optional(),
  attendeeStaffIds: z.array(z.string().uuid()).optional(),
});
export type CreateTumourBoardDecisionDto = z.infer<typeof CreateTumourBoardDecisionSchema>;

export const TumourBoardDecisionResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  conditionId: z.string().uuid(),
  meetingDate: z.string(),
  recommendation: z.string(),
  rationale: z.string().nullable(),
  attendeeStaffIds: z.array(z.string().uuid()).nullable(),
  chairedByStaffId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type TumourBoardDecisionResponse = z.infer<typeof TumourBoardDecisionResponseSchema>;

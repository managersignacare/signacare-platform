// packages/shared/src/problemList.schemas.ts
//
// Multi-specialty Phase 3 — Internal Medicine: problem list DTOs.
//
// FHIR R5 Condition-aligned. These DTOs are the contract between the
// backend internal-medicine feature and the frontend problem list tab.
// Every specialty reads the same shape — the problem list is a core,
// always-on surface, not a mental-health-only thing.
import { z } from 'zod';

export const ProblemCategoryEnum = z.enum([
  'problem-list-item',
  'encounter-diagnosis',
  'health-concern',
]);
export type ProblemCategory = z.infer<typeof ProblemCategoryEnum>;

export const ClinicalStatusEnum = z.enum([
  'active',
  'recurrence',
  'relapse',
  'inactive',
  'remission',
  'resolved',
]);
export type ClinicalStatus = z.infer<typeof ClinicalStatusEnum>;

export const VerificationStatusEnum = z.enum([
  'unconfirmed',
  'provisional',
  'differential',
  'confirmed',
  'refuted',
  'entered-in-error',
]);
export type VerificationStatus = z.infer<typeof VerificationStatusEnum>;

export const ProblemSeverityEnum = z.enum(['mild', 'moderate', 'severe']);
export type ProblemSeverity = z.infer<typeof ProblemSeverityEnum>;

export const ProblemCodeSystemEnum = z.enum(['snomed', 'icd10', 'icpc2', 'local']);
export type ProblemCodeSystem = z.infer<typeof ProblemCodeSystemEnum>;

export const CreateProblemSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  codeSystem: ProblemCodeSystemEnum.default('snomed'),
  code: z.string().min(1).max(40),
  display: z.string().min(1).max(500),
  category: ProblemCategoryEnum.default('problem-list-item'),
  clinicalStatus: ClinicalStatusEnum.default('active'),
  verificationStatus: VerificationStatusEnum.default('confirmed'),
  severity: ProblemSeverityEnum.nullable().optional(),
  isChronic: z.boolean().default(false),
  onsetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  onsetAgeYears: z.number().int().min(0).max(120).nullable().optional(),
  abatementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});
export type CreateProblemDTO = z.infer<typeof CreateProblemSchema>;

export const UpdateProblemSchema = CreateProblemSchema.partial().omit({ patientId: true });
export type UpdateProblemDTO = z.infer<typeof UpdateProblemSchema>;

export const ProblemListEntrySchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  codeSystem: ProblemCodeSystemEnum,
  code: z.string(),
  display: z.string(),
  category: ProblemCategoryEnum,
  clinicalStatus: ClinicalStatusEnum,
  verificationStatus: VerificationStatusEnum,
  severity: ProblemSeverityEnum.nullable(),
  isChronic: z.boolean(),
  onsetDate: z.string().nullable(),
  onsetAgeYears: z.number().nullable(),
  abatementDate: z.string().nullable(),
  note: z.string().nullable(),
  recordedDate: z.string(),
  recordedBy: z.string().uuid().nullable(),
  recordedByName: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProblemListEntry = z.infer<typeof ProblemListEntrySchema>;

export const ProblemListFiltersSchema = z.object({
  clinicalStatus: ClinicalStatusEnum.optional(),
  isChronic: z.coerce.boolean().optional(),
  category: ProblemCategoryEnum.optional(),
});
export type ProblemListFilters = z.infer<typeof ProblemListFiltersSchema>;

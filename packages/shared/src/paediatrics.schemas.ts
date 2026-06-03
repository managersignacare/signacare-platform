// packages/shared/src/paediatrics.schemas.ts
//
// Multi-specialty Phase 5 — Paediatrics: shared DTOs.
//
// Three resources, all patient-level (chronic tracking spans
// episodes):
//   - growth_measurements      (FHIR Observation-aligned)
//   - immunizations            (CVX-coded, FHIR Immunization-aligned)
//   - developmental_milestones (WHO five-domain framework)
import { z } from 'zod';

// ── Growth measurements ───────────────────────────────────────────────────

export const GrowthMeasurementTypeEnum = z.enum([
  'weight_kg',
  'height_cm',
  'head_circumference_cm',
  'bmi',
]);
export type GrowthMeasurementType = z.infer<typeof GrowthMeasurementTypeEnum>;

export const GrowthReferenceSourceEnum = z.enum(['who', 'cdc', 'local', 'unknown']);
export type GrowthReferenceSource = z.infer<typeof GrowthReferenceSourceEnum>;

export const CreateGrowthMeasurementSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  measurementType: GrowthMeasurementTypeEnum,
  value: z.number().positive().max(10000),
  unit: z.string().min(1).max(10),
  ageAtMeasurementDays: z.number().int().min(0).max(36524),
  percentile: z.number().min(0).max(100).nullable().optional(),
  zScore: z.number().min(-10).max(10).nullable().optional(),
  referenceSource: GrowthReferenceSourceEnum.nullable().optional(),
  measuredAt: z.string().datetime(),
  note: z.string().max(2000).nullable().optional(),
});
export type CreateGrowthMeasurementDTO = z.infer<typeof CreateGrowthMeasurementSchema>;

export const GrowthMeasurementResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  measurementType: GrowthMeasurementTypeEnum,
  value: z.number(),
  unit: z.string(),
  ageAtMeasurementDays: z.number().int(),
  percentile: z.number().nullable(),
  zScore: z.number().nullable(),
  referenceSource: GrowthReferenceSourceEnum.nullable(),
  measuredAt: z.string(),
  recordedBy: z.string().uuid().nullable(),
  recordedByName: z.string().nullable().optional(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GrowthMeasurementResponse = z.infer<typeof GrowthMeasurementResponseSchema>;

// ── Immunizations ─────────────────────────────────────────────────────────

export const ImmunizationStatusEnum = z.enum(['completed', 'entered-in-error', 'not-done']);
export type ImmunizationStatus = z.infer<typeof ImmunizationStatusEnum>;

export const ImmunizationSiteEnum = z.enum([
  'left-deltoid',
  'right-deltoid',
  'left-thigh',
  'right-thigh',
  'left-buttock',
  'right-buttock',
  'oral',
  'nasal',
  'other',
]);
export type ImmunizationSite = z.infer<typeof ImmunizationSiteEnum>;

export const ImmunizationRouteEnum = z.enum(['IM', 'SC', 'ID', 'PO', 'IN', 'other']);
export type ImmunizationRoute = z.infer<typeof ImmunizationRouteEnum>;

export const CreateImmunizationSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  cvxCode: z.string().min(1).max(10),
  vaccineName: z.string().min(1).max(200),
  manufacturer: z.string().max(100).nullable().optional(),
  seriesName: z.string().max(100).nullable().optional(),
  doseNumber: z.number().int().positive().max(19).nullable().optional(),
  seriesDoses: z.number().int().positive().max(19).nullable().optional(),
  administeredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lotNumber: z.string().max(50).nullable().optional(),
  expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  site: ImmunizationSiteEnum.nullable().optional(),
  route: ImmunizationRouteEnum.nullable().optional(),
  doseQuantityMl: z.number().positive().max(99).nullable().optional(),
  status: ImmunizationStatusEnum.default('completed'),
  notDoneReason: z.string().max(500).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});
export type CreateImmunizationDTO = z.infer<typeof CreateImmunizationSchema>;

export const ImmunizationResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  cvxCode: z.string(),
  vaccineName: z.string(),
  manufacturer: z.string().nullable(),
  seriesName: z.string().nullable(),
  doseNumber: z.number().nullable(),
  seriesDoses: z.number().nullable(),
  administeredDate: z.string(),
  lotNumber: z.string().nullable(),
  expirationDate: z.string().nullable(),
  site: ImmunizationSiteEnum.nullable(),
  route: ImmunizationRouteEnum.nullable(),
  doseQuantityMl: z.number().nullable(),
  status: ImmunizationStatusEnum,
  notDoneReason: z.string().nullable(),
  note: z.string().nullable(),
  administeredBy: z.string().uuid().nullable(),
  administeredByName: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ImmunizationResponse = z.infer<typeof ImmunizationResponseSchema>;

// ── Developmental milestones ──────────────────────────────────────────────

export const MilestoneDomainEnum = z.enum([
  'gross_motor',
  'fine_motor',
  'language',
  'cognitive',
  'social_emotional',
]);
export type MilestoneDomain = z.infer<typeof MilestoneDomainEnum>;

export const MilestoneStatusEnum = z.enum(['achieved', 'delayed', 'not_assessed', 'regression']);
export type MilestoneStatus = z.infer<typeof MilestoneStatusEnum>;

export const CreateMilestoneSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  domain: MilestoneDomainEnum,
  milestone: z.string().min(1).max(200),
  expectedAgeMonths: z.number().int().min(0).max(240).nullable().optional(),
  achievedAtMonths: z.number().int().min(0).max(240).nullable().optional(),
  status: MilestoneStatusEnum.default('not_assessed'),
  note: z.string().max(2000).nullable().optional(),
});
export type CreateMilestoneDTO = z.infer<typeof CreateMilestoneSchema>;

export const MilestoneResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  domain: MilestoneDomainEnum,
  milestone: z.string(),
  expectedAgeMonths: z.number().nullable(),
  achievedAtMonths: z.number().nullable(),
  status: MilestoneStatusEnum,
  note: z.string().nullable(),
  assessedAt: z.string(),
  assessedBy: z.string().uuid().nullable(),
  assessedByName: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MilestoneResponse = z.infer<typeof MilestoneResponseSchema>;

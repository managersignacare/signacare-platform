// packages/shared/src/endocrinology.schemas.ts
//
// Multi-specialty Phase 4 — Endocrinology: shared DTOs.
//
// Two resources: glucose readings (time-series) and insulin regimens
// (versioned prescription state). Both are patient-level so chronic
// management spans episodes.
import { z } from 'zod';

// ── Glucose reading ──────────────────────────────────────────────────────

export const GlucoseSourceEnum = z.enum(['cgm', 'fingerstick', 'lab', 'manual']);
export type GlucoseSource = z.infer<typeof GlucoseSourceEnum>;

export const GlucoseUnitEnum = z.enum(['mmol/L', 'mg/dL']);
export type GlucoseUnit = z.infer<typeof GlucoseUnitEnum>;

export const GlucoseMealContextEnum = z.enum([
  'fasting',
  'pre_meal',
  'post_meal_1h',
  'post_meal_2h',
  'bedtime',
  'random',
  'overnight',
]);
export type GlucoseMealContext = z.infer<typeof GlucoseMealContextEnum>;

export const CreateGlucoseReadingSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  value: z.number().positive().max(1000),
  unit: GlucoseUnitEnum.default('mmol/L'),
  source: GlucoseSourceEnum.default('fingerstick'),
  mealContext: GlucoseMealContextEnum.nullable().optional(),
  measuredAt: z.string().datetime(),
  note: z.string().max(2000).nullable().optional(),
});
export type CreateGlucoseReadingDTO = z.infer<typeof CreateGlucoseReadingSchema>;

export const GlucoseReadingResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  value: z.number(),
  unit: GlucoseUnitEnum,
  source: GlucoseSourceEnum,
  mealContext: GlucoseMealContextEnum.nullable(),
  measuredAt: z.string(),
  note: z.string().nullable(),
  recordedBy: z.string().uuid().nullable(),
  recordedByName: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GlucoseReadingResponse = z.infer<typeof GlucoseReadingResponseSchema>;

export const GlucoseListFiltersSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  source: GlucoseSourceEnum.optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});
export type GlucoseListFilters = z.infer<typeof GlucoseListFiltersSchema>;

/**
 * Time-In-Range summary derived from a glucose reading window.
 * Standard ATTD ranges (mmol/L):
 *   Very Low  : < 3.0
 *   Low       : 3.0 – 3.8
 *   In Range  : 3.9 – 10.0
 *   High      : 10.1 – 13.9
 *   Very High : > 13.9
 */
export const TimeInRangeSummarySchema = z.object({
  totalReadings: z.number().int(),
  meanGlucose: z.number().nullable(),
  veryLow: z.number(),
  low: z.number(),
  inRange: z.number(),
  high: z.number(),
  veryHigh: z.number(),
  veryLowPct: z.number(),
  lowPct: z.number(),
  inRangePct: z.number(),
  highPct: z.number(),
  veryHighPct: z.number(),
});
export type TimeInRangeSummary = z.infer<typeof TimeInRangeSummarySchema>;

// ── Insulin regimen ──────────────────────────────────────────────────────

export const InsulinBolusDosesSchema = z.object({
  breakfast: z.number().nonnegative().nullable().optional(),
  lunch: z.number().nonnegative().nullable().optional(),
  dinner: z.number().nonnegative().nullable().optional(),
  bedtime: z.number().nonnegative().nullable().optional(),
});
export type InsulinBolusDoses = z.infer<typeof InsulinBolusDosesSchema>;

export const CreateInsulinRegimenSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  basalDrug: z.string().max(100).nullable().optional(),
  basalDoseUnits: z.number().positive().max(500).nullable().optional(),
  basalFrequency: z.string().max(50).nullable().optional(),
  bolusDrug: z.string().max(100).nullable().optional(),
  bolusDoses: InsulinBolusDosesSchema.nullable().optional(),
  correctionFactor: z.number().positive().max(100).nullable().optional(),
  carbRatio: z.number().positive().max(100).nullable().optional(),
  targetLow: z.number().positive().max(50).nullable().optional(),
  targetHigh: z.number().positive().max(50).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});
export type CreateInsulinRegimenDTO = z.infer<typeof CreateInsulinRegimenSchema>;

export const InsulinRegimenResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  basalDrug: z.string().nullable(),
  basalDoseUnits: z.number().nullable(),
  basalFrequency: z.string().nullable(),
  bolusDrug: z.string().nullable(),
  bolusDoses: InsulinBolusDosesSchema.nullable(),
  correctionFactor: z.number().nullable(),
  carbRatio: z.number().nullable(),
  targetLow: z.number().nullable(),
  targetHigh: z.number().nullable(),
  validFrom: z.string(),
  validTo: z.string().nullable(),
  note: z.string().nullable(),
  prescribedBy: z.string().uuid().nullable(),
  prescribedByName: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type InsulinRegimenResponse = z.infer<typeof InsulinRegimenResponseSchema>;

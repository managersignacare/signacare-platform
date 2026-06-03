// packages/shared/src/obsGyne.schemas.ts
//
// Multi-specialty Phase 6 — Obstetrics & Gynaecology: shared DTOs.
//
// Two resources, both scoped to the episode of care:
//
//   - pregnancies      (one per ongoing / closed gestation, FHIR
//                       EpisodeOfCare-like — start at LMP, end at
//                       delivery / miscarriage / termination)
//   - antenatal_visits (per-visit observations — FHIR Encounter
//                       with embedded Observations for fundal
//                       height, fetal HR, BP, urinalysis)
//
// Partograms and CTG traces (from the original Phase 6 plan) are
// deliberately deferred — the per-visit flowsheet covers the MVP
// and the blob-backed tracings need bespoke UI that's out of scope
// for this delivery.
import { z } from 'zod';

// ── Pregnancy ─────────────────────────────────────────────────────────────

export const PregnancyStatusEnum = z.enum([
  'ongoing',
  'delivered',
  'miscarried',
  'terminated',
]);
export type PregnancyStatus = z.infer<typeof PregnancyStatusEnum>;

/**
 * GTPAL — Gravida / Term / Preterm / Abortions / Living.
 * Captured as a single JSONB column so we can extend the set later
 * without schema churn. All counts are non-negative integers.
 */
export const GtpalSchema = z.object({
  gravida: z.number().int().min(0).max(30),
  term: z.number().int().min(0).max(30),
  preterm: z.number().int().min(0).max(30),
  abortions: z.number().int().min(0).max(30),
  living: z.number().int().min(0).max(30),
});
export type Gtpal = z.infer<typeof GtpalSchema>;

export const CreatePregnancySchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  lmpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'LMP must be YYYY-MM-DD'),
  // EDD is optional because the backend auto-computes it via Naegele's
  // rule from LMP when not provided.
  eddDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  gtpal: GtpalSchema,
  status: PregnancyStatusEnum.optional(),
  note: z.string().max(2000).nullable().optional(),
});
export type CreatePregnancyDTO = z.infer<typeof CreatePregnancySchema>;

export const PregnancyResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  lmpDate: z.string(),
  eddDate: z.string(),
  gtpal: GtpalSchema,
  status: PregnancyStatusEnum,
  note: z.string().nullable(),
  recordedBy: z.string().uuid().nullable(),
  recordedByName: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PregnancyResponse = z.infer<typeof PregnancyResponseSchema>;

// ── Antenatal Visit ───────────────────────────────────────────────────────

export const UrineDipstickEnum = z.enum(['negative', 'trace', '+', '++', '+++', '++++']);
export type UrineDipstick = z.infer<typeof UrineDipstickEnum>;

export const CreateAntenatalVisitSchema = z.object({
  pregnancyId: z.string().uuid(),
  visitNumber: z.number().int().min(1).max(60),
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'visitDate must be YYYY-MM-DD'),
  gaWeeks: z.number().int().min(0).max(45),
  gaDays: z.number().int().min(0).max(6),
  fundalHeightCm: z.number().min(0).max(60).nullable().optional(),
  fetalHeartRateBpm: z.number().int().min(60).max(220).nullable().optional(),
  bpSystolic: z.number().int().min(40).max(260).nullable().optional(),
  bpDiastolic: z.number().int().min(20).max(180).nullable().optional(),
  urineProtein: UrineDipstickEnum.nullable().optional(),
  urineGlucose: UrineDipstickEnum.nullable().optional(),
  oedema: z.boolean().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});
export type CreateAntenatalVisitDTO = z.infer<typeof CreateAntenatalVisitSchema>;

export const AntenatalVisitResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  pregnancyId: z.string().uuid(),
  patientId: z.string().uuid(),
  visitNumber: z.number().int(),
  visitDate: z.string(),
  gaWeeks: z.number().int(),
  gaDays: z.number().int(),
  fundalHeightCm: z.number().nullable(),
  fetalHeartRateBpm: z.number().int().nullable(),
  bpSystolic: z.number().int().nullable(),
  bpDiastolic: z.number().int().nullable(),
  urineProtein: UrineDipstickEnum.nullable(),
  urineGlucose: UrineDipstickEnum.nullable(),
  oedema: z.boolean().nullable(),
  note: z.string().nullable(),
  seenBy: z.string().uuid().nullable(),
  seenByName: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AntenatalVisitResponse = z.infer<typeof AntenatalVisitResponseSchema>;

// ── Naegele helper ────────────────────────────────────────────────────────

/**
 * Naegele's rule: EDD = LMP + 7 days − 3 months + 1 year.
 * Kept in shared so frontend "preview EDD" and backend "autofill on
 * create" can't drift.
 */
export function computeEddFromLmp(lmpIso: string): string {
  const lmp = new Date(`${lmpIso}T00:00:00Z`);
  const edd = new Date(lmp);
  edd.setUTCDate(edd.getUTCDate() + 7);
  edd.setUTCMonth(edd.getUTCMonth() - 3);
  edd.setUTCFullYear(edd.getUTCFullYear() + 1);
  return edd.toISOString().slice(0, 10);
}

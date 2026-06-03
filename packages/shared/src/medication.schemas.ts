import { z } from 'zod';

// BUG-456 absorb-2 (L3 REJECT-2 fold-in, user-authorized 2026-04-25):
// the SSoT enum MUST honour every value the DB CHECK constraint allows.
// Pre-absorb-2 the SSoT lied — only `active` and `ceased` overlapped
// with the DB-allowed set, so a real row with `paused`/`draft`/
// `ceased_discontinued` would have been silently dropped from the list
// endpoint (toResponseListSafe skip+warn) or 500'd on getById.
//
// Union shape:
//   - DB CHECK at apps/api/migrations/20260701000000_baseline.ts:2154-2155
//     allows: active, ceased, ceased_discontinued, paused, draft
//   - UI / clinical state set adds: tapering, suspended, on_hold
//   - SSoT now mirrors the UNION (8 values).
//
// Future cleanup (BUG-511): audit which of the DB-only values
// (`ceased_discontinued`, `paused`, `draft`) are dead, then migrate the
// DB CHECK to drop them + add the aspirational UI states. Today only
// `active` (312 rows) and `ceased` (24 rows) actually exist.
export const MedicationStatusEnum = z.enum([
  'active',
  'tapering',
  'ceased',
  'ceased_discontinued',
  'suspended',
  'on_hold',
  'paused',
  'draft',
]);

export const MedicationCreateSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  drugProductId: z.string().uuid().optional(),
  drugCode: z.string().max(50).optional(),
  drugLabel: z.string().min(1).max(300),
  genericName: z.string().max(200).optional(),
  brandName: z.string().max(200).optional(),
  dose: z.string().min(1).max(100),
  doseUnit: z.string().max(30).optional(),
  route: z.string().max(50).optional().default('oral'),
  frequency: z.string().min(1).max(100),
  instructions: z.string().optional(),
  indication: z.string().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  isRegular: z.boolean().default(true),
  isPrn: z.boolean().default(false),
  isLai: z.boolean().default(false),
  taperSchedule: z.record(z.string(), z.unknown()).optional(),
  source: z.string().max(30).optional().default('manual'),
  notes: z.string().optional(),
});
export type MedicationCreateDTO = z.infer<typeof MedicationCreateSchema>;

export const MedicationUpdateSchema = MedicationCreateSchema.partial().omit({
  patientId: true,
}).extend({
  // BUG-371b — REQUIRED expected lock_version per CLAUDE.md §1.6.
  // Frontend reads `lockVersion` from the GET response and sends it
  // back here. Helper throws AppError(409, 'OPTIMISTIC_LOCK_CONFLICT')
  // on mismatch.
  expectedLockVersion: z.number().int().positive(),
});
export type MedicationUpdateDTO = z.infer<typeof MedicationUpdateSchema>;

export const MedicationCeaseSchema = z.object({
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reasonForCessation: z.string().min(1).max(500),
  // BUG-371b — REQUIRED expected lock_version per CLAUDE.md §1.6.
  expectedLockVersion: z.number().int().positive(),
});
export type MedicationCeaseDTO = z.infer<typeof MedicationCeaseSchema>;

export const MedicationResponseSchema = z.object({
  id: z.string().uuid(),
  // BUG-371b — opt-lock version. Frontend MUST send this back as
  // `expectedLockVersion` on the next mutation per CLAUDE.md §1.6.
  lockVersion: z.number().int().positive(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  drugProductId: z.string().uuid().nullable(),
  drugCode: z.string().nullable(),
  drugLabel: z.string(),
  // BUG-456 L3+L4 absorb-1 — derived alias for `drugLabel`. Frontend
  // surfaces (MedicationsTab, SummaryTab, TrackingTab, AmbientAiRecorder)
  // read `m.medicationName` directly without a `??` fallback in many
  // sites. Ship as a derived alias to avoid silent blank cells until
  // BUG-465 cleans up the `any`-typed legacy readers.
  medicationName: z.string(),
  genericName: z.string().nullable(),
  brandName: z.string().nullable(),
  dose: z.string(),
  doseUnit: z.string().nullable(),
  route: z.string(),
  frequency: z.string(),
  instructions: z.string().nullable(),
  indication: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  status: MedicationStatusEnum,
  reasonForCessation: z.string().nullable(),
  isRegular: z.boolean(),
  isPrn: z.boolean(),
  isLai: z.boolean(),
  // BUG-456 L4 absorb-1 — derived clinical-safety flags. The frontend
  // Clozapine sub-tab filter (MedicationsTab.tsx:124), Schedule 8
  // SafeScript banner (lines 227-228), printed-prescription warnings
  // (lines 382-411), and Clinical Review icon coloring depend on
  // these. Pre-fix the backend mapper computed them from
  // `category === 'clozapine'/'s8'` but dropped them; absorb-1
  // restores them to the wire as derived booleans. Underlying
  // canonical source is `drug_code` lookup (BUG-465 follow-up).
  isClozapine: z.boolean(),
  isS8: z.boolean(),
  // BUG-456 L4 absorb-1 — passthrough for `noteMacros.ts /meds` macro
  // which reads `m.category` to surface controlled-substance schedule
  // tags in dictation. Keeping on wire avoids silent loss of AHPRA
  // traceability annotation in clinical notes.
  category: z.string().nullable(),
  // BUG-456 L4 absorb-1 — derived alias for `startDate` (legacy name
  // used by `PatientDetailLayout.tsx:600` supply-low alert label).
  prescribedAt: z.string().nullable(),
  // BUG-456 L4 absorb-1 — passthrough fields with always-null values
  // today. The LAI scheduling fields live in the `lai_schedules` table
  // (per `medicationRepository.ts:11-26` ghost-column comment) and are
  // returned as `null` here; UI degrades gracefully. Real LAI
  // integration is a future feature, not BUG-456 scope.
  laiFrequency: z.string().nullable(),
  laiNextDue: z.string().nullable(),
  laiLastAdmin: z.string().nullable(),
  prescriber: z.string().nullable(),
  prescribedBySpecialty: z.string().nullable(),
  taperSchedule: z.unknown().nullable(),
  // BUG-456 L4 absorb-1 — widened to nullable. DB column is `string |
  // null`; pre-absorb default-coalesce to 'manual' mis-attributed
  // imported / e-prescribed records that have NULL source.
  source: z.string().nullable(),
  prescribedByStaffId: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MedicationResponse = z.infer<typeof MedicationResponseSchema>;

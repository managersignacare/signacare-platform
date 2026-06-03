import { z } from 'zod';
import { SafeScriptCheckResultSchema } from './safeScript.schemas';

export const PrescriptionStatusEnum = z.enum([
  'draft',
  'active',
  'dispensed',
  'cancelled',
  'expired',
  'locked',
]);

export const PrescriptionCategoryEnum = z.enum([
  'outpatient',
  'inpatient',
  'discharge',
]);
export type PrescriptionCategory = z.infer<typeof PrescriptionCategoryEnum>;

export const PrescriptionCreateSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  drugProductId: z.string().uuid().optional(),
  patientMedicationId: z.string().uuid().optional(),
  genericName: z.string().min(1).max(200),
  brandName: z.string().max(200).optional(),
  dose: z.string().min(1).max(100),
  route: z.string().min(1).max(50),
  frequency: z.string().min(1).max(100),
  directions: z.string().optional(),
  quantity: z.number().int().positive(),
  repeats: z.number().int().min(0).default(0),
  pbsItemCode: z.string().max(20).optional(),
  isAuthority: z.boolean().default(false),
  authorityCode: z.string().max(50).optional(),
  isS8: z.boolean().default(false),
  prescriptionType: z.string().max(30).default('standard'),
  prescriptionCategory: PrescriptionCategoryEnum.default('outpatient'),
  prescribedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  isElectronic: z.boolean().default(true),
  notes: z.string().optional(),
}).superRefine((value, ctx) => {
  if (!value.isAuthority) {
    return;
  }
  if (!value.pbsItemCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pbsItemCode'],
      message: 'PBS item code is required for authority prescriptions.',
    });
  }
  if (!value.authorityCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['authorityCode'],
      message: 'Authority code is required for authority prescriptions.',
    });
  }
});
export type PrescriptionCreateDTO = z.infer<typeof PrescriptionCreateSchema>;

export const PrescriptionResponseSchema = z.object({
  id: z.string().uuid(),
  // BUG-371b — opt-lock version. Frontend MUST send back as
  // expectedLockVersion on cancel / submitErx.
  lockVersion: z.number().int().positive(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  // BUG-553 — exposed for frontend so the medications panel can resolve
  // medication-id → active-prescription-id when cancelling an eScript.
  patientMedicationId: z.string().uuid().nullable(),
  prescribedByStaffId: z.string().uuid(),
  genericName: z.string(),
  brandName: z.string().nullable(),
  dose: z.string(),
  route: z.string(),
  frequency: z.string(),
  directions: z.string().nullable(),
  quantity: z.number(),
  repeats: z.number(),
  pbsItemCode: z.string().nullable(),
  isAuthority: z.boolean(),
  authorityCode: z.string().nullable(),
  isS8: z.boolean(),
  prescriptionType: z.string(),
  prescriptionCategory: PrescriptionCategoryEnum,
  status: PrescriptionStatusEnum,
  safescriptChecked: z.boolean(),
  safescriptCheckedAt: z.string().nullable(),
  safescriptResult: SafeScriptCheckResultSchema.nullable(),
  erxToken: z.string().nullable(),
  erxDspId: z.string().nullable(),
  erxSubmittedAt: z.string().nullable(),
  isElectronic: z.boolean(),
  prescribedDate: z.string(),
  expiryDate: z.string().nullable(),
  notes: z.string().nullable(),
  // BUG-553 — cancellation-audit fields. Non-null only when status='cancelled'
  // AND row was cancelled AFTER the BUG-553 migration. NULL on pre-fix
  // cancellations (forensic dashboards must treat NULL as "pre-BUG-553
  // cancellation, reason not captured" rather than "cancellation without reason").
  cancellationReason: z.string().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  cancelledByStaffId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PrescriptionResponse = z.infer<typeof PrescriptionResponseSchema>;

/**
 * BUG-553 — cancellation request DTO. Frontend posts to `/prescriptions/:id/cancel`
 * with both lock-version (BUG-371b) and reason (BUG-553). 1..500 char Zod
 * bound matches the medication-cease precedent (clinical reason length —
 * concise rather than essay-length; longer reasons go in the clinical note).
 */
export const PrescriptionCancelSchema = z.object({
  expectedLockVersion: z.number().int().positive(),
  reasonForCancellation: z.string().min(1).max(500),
});
export type PrescriptionCancelDTO = z.infer<typeof PrescriptionCancelSchema>;

/**
 * BUG-553 cycle-2 (L4 CONCERN-1) — cancel response carries the DSP-side
 * token-revocation status alongside the updated prescription. Two-phase:
 *   - 'revoked'        — DSP confirmed the token cancellation (NPDS or eRx REST)
 *   - 'pending'        — local cancel succeeded; DSP call failed or unavailable;
 *                         pharmacy MAY still dispense until reconciliation cron
 *                         (filed as BUG-553-FOLLOWUP-DSP-RECONCILE) catches up
 *   - 'not-applicable' — prescription was paper-only or had no active token
 * Frontend MUST surface 'pending' clearly to the clinician — the dialog
 * cannot claim the eScript is unredeemable when DSP revocation is pending.
 */
export const PrescriptionCancelResponseSchema = z.object({
  prescription: PrescriptionResponseSchema,
  dspRevocation: z.enum(['revoked', 'pending', 'not-applicable']),
});
export type PrescriptionCancelResponse = z.infer<typeof PrescriptionCancelResponseSchema>;

export const ErxTokenResponseSchema = z.object({
  id: z.string().uuid(),
  prescriptionId: z.string().uuid(),
  tokenValue: z.string(),
  // @zod-convention-exempt: `dspId` is the external NPDS-issued Dispensing Service Provider identifier (vendor-protocol contract; not a Signacare row UUID).
  dspId: z.string().nullable(),
  npdsReference: z.string().nullable(),
  status: z.enum(['issued', 'dispensed', 'partially_dispensed', 'cancelled', 'expired']),
  issuedAt: z.string(),
  expiresAt: z.string().nullable(),
  dispensedAt: z.string().nullable(),
  dispensingPharmacy: z.string().nullable(),
  createdAt: z.string(),
});
export type ErxTokenResponse = z.infer<typeof ErxTokenResponseSchema>;

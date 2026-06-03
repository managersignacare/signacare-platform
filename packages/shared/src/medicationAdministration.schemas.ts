// packages/shared/src/medicationAdministration.schemas.ts
//
// BUG-622 — canonical Zod schemas for the `medication_administrations`
// surface (the AHPRA-required medication chart audit trail). The
// frontend MarChartPanel sends a POST when a nurse records a dose;
// pre-fix the field-name drift between frontend payload and backend
// destructure caused 5 fields to be silently NULL or dropped on the
// success path:
//
//   Frontend sends             → Backend reads → DB column
//   ──────────────────────────────────────────────────────
//   patientMedicationId        → prescriptionId → patient_medication_id (NULL pre-fix)
//   administeredTime           → givenAt         → administered_time (db.fn.now() fallback pre-fix)
//   doseGiven                  → dose            → dose_given (NULL pre-fix)
//   administrationContext      → (not read)      → DOES NOT EXIST PRE-FIX (silently dropped)
//   prnReason                  → (not read)      → DOES NOT EXIST PRE-FIX (silently dropped)
//
// Result: success-path rows missing patient_medication_id → broke the
// MAR longitudinal-report join → next time-slot rendered "not-due" →
// DOUBLE-DOSING harm class (the EXACT class BUG-615's belt copy names).
//
// Post-fix:
// 1. Migration adds `administration_context` + `prn_reason` columns.
// 2. This canonical Zod schema is the SSoT contract for the wire shape.
// 3. Backend handler validates request body via this schema and maps
//    camel → snake at the INSERT boundary.
// 4. Backend mapper applies snake → camel on the response per
//    CLAUDE.md §5.2 (sibling pattern to BUG-613/618).

import { z } from 'zod';

export const MedicationAdministrationStatusEnum = z.enum([
  'given',
  'refused',
  'withheld',
  'not-due',
  'scheduled',
]);

export const MedicationAdministrationContextEnum = z.enum([
  'supervised',
  'self_administered',
  'inpatient',
  'community',
  'supervised_family',
  'patient_app',
]);

export const MedicationAdministrationCreateSchema = z.object({
  patientId: z.string().uuid(),
  patientMedicationId: z.string().uuid(),
  scheduledTime: z.string(),
  status: MedicationAdministrationStatusEnum.default('given'),
  administeredTime: z.string().optional(),
  doseGiven: z.string().optional(),
  route: z.string().optional(),
  site: z.string().optional(),
  notes: z.string().optional(),
  reasonNotGiven: z.string().optional(),
  witnessId: z.string().uuid().optional(),
  batchNumber: z.string().optional(),
  administrationContext: MedicationAdministrationContextEnum.optional(),
  prnReason: z.string().optional(),
});
export type MedicationAdministrationCreateDTO = z.infer<typeof MedicationAdministrationCreateSchema>;

export const MedicationAdministrationResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  // BUG-626 — DB now enforces NOT NULL on patient_medication_id (Layer C
  // defence-in-depth below the BUG-622 Zod request boundary). Response
  // shape is non-nullable post-migration; legacy NULL rows were 0
  // (audit confirmed) so no backwards-compat tolerance needed.
  patientMedicationId: z.string().uuid(),
  scheduledTime: z.string().nullable(),
  status: z.string(),
  administeredTime: z.string().nullable(),
  administeredByStaffId: z.string().uuid().nullable(),
  doseGiven: z.string().nullable(),
  route: z.string().nullable(),
  site: z.string().nullable(),
  notes: z.string().nullable(),
  reasonNotGiven: z.string().nullable(),
  witnessedByStaffId: z.string().uuid().nullable(),
  batchNumber: z.string().nullable(),
  administrationContext: z.string().nullable(),
  prnReason: z.string().nullable(),
  createdAt: z.string(),
  // BUG-PR-R1-12-FIX-S0-medication_administrations — opt-locking version.
  // Future UPDATE paths require the client to echo this back as
  // `expectedLockVersion`. Non-negative integer per CLAUDE.md §1.6.
  lockVersion: z.number().int().nonnegative(),
});
export type MedicationAdministrationResponse = z.infer<typeof MedicationAdministrationResponseSchema>;

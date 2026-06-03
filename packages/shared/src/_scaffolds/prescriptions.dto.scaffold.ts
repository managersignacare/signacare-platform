// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PrescriptionsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  drugProductId: z.string().uuid().nullable().optional(),
  prescribedByStaffId: z.string().uuid(),
  patientMedicationId: z.string().uuid().nullable().optional(),
  genericName: z.string().max(300),
  brandName: z.string().max(300).nullable().optional(),
  dose: z.string().max(100),
  route: z.string().max(50),
  frequency: z.string().max(100),
  directions: z.string().nullable().optional(),
  quantity: z.number().int(),
  repeats: z.number().int(),
  pbsItemCode: z.string().max(20).nullable().optional(),
  isAuthority: z.boolean(),
  authorityCode: z.string().max(50).nullable().optional(),
  isS8: z.boolean(),
  prescriptionType: z.string().max(30),
  status: z.string().max(30),
  safescriptChecked: z.boolean(),
  safescriptCheckedAt: z.string().datetime().nullable().optional(),
  safescriptResult: z.unknown().nullable().optional(),
  erxToken: z.string().max(200).nullable().optional(),
  erxDspId: z.string().max(100).nullable().optional(),
  erxSubmittedAt: z.string().datetime().nullable().optional(),
  isElectronic: z.boolean(),
  prescribedDate: z.string(),
  expiresAt: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
  prescriptionCategory: z.string().max(30),
  lockVersion: z.number().int(),
  cancellationReason: z.string().nullable().optional(),
  cancelledAt: z.string().datetime().nullable().optional(),
  cancelledByStaffId: z.string().uuid().nullable().optional(),
});

export type PrescriptionsDtoScaffold = z.infer<typeof PrescriptionsDtoScaffoldSchema>;

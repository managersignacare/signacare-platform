// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PatientMedicationsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  drugProductId: z.string().uuid().nullable().optional(),
  drugCode: z.string().max(50).nullable().optional(),
  drugLabel: z.string().max(300),
  genericName: z.string().max(300).nullable().optional(),
  brandName: z.string().max(300).nullable().optional(),
  dose: z.string().max(100),
  doseUnit: z.string().max(50).nullable().optional(),
  route: z.string().max(50),
  frequency: z.string().max(100),
  instructions: z.string().nullable().optional(),
  indication: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  status: z.string().max(30),
  reasonForCessation: z.string().nullable().optional(),
  isRegular: z.boolean(),
  isPrn: z.boolean(),
  isLai: z.boolean(),
  taperSchedule: z.unknown().nullable().optional(),
  source: z.string().max(30),
  prescribedByStaffId: z.string().uuid().nullable().optional(),
  recordedByStaffId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
  prescribedBySpecialtyCode: z.string().max(40).nullable().optional(),
  category: z.string().max(60).nullable().optional(),
  lockVersion: z.number().int(),
});

export type PatientMedicationsDtoScaffold = z.infer<typeof PatientMedicationsDtoScaffoldSchema>;

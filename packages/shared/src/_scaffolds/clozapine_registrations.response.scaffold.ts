// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ClozapineRegistrationsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  drugProductId: z.string().uuid().nullable().optional(),
  prescriberStaffId: z.string().uuid().nullable().optional(),
  registrationDate: z.string(),
  dispenserPharmacy: z.string().max(200).nullable().optional(),
  currentDoseMg: z.string().regex(/^-?\d{1,6}(\.\d{0,2})?$/).nullable().optional(),
  titrationPhase: z.string().max(30),
  monitoringWeek: z.number().int().nullable().optional(),
  monitoringFrequency: z.string().max(30),
  lastAncDate: z.string().nullable().optional(),
  lastAncValue: z.string().regex(/^-?\d{1,6}(\.\d{0,2})?$/).nullable().optional(),
  ancStatus: z.string().max(30),
  lastWbcDate: z.string().nullable().optional(),
  lastWbcValue: z.string().regex(/^-?\d{1,6}(\.\d{0,2})?$/).nullable().optional(),
  nextBloodDueDate: z.string().nullable().optional(),
  physicalHealthCheckDue: z.string().nullable().optional(),
  ceasedDate: z.string().nullable().optional(),
  ceasedReason: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type ClozapineRegistrationsResponseScaffold = z.infer<typeof ClozapineRegistrationsResponseScaffoldSchema>;

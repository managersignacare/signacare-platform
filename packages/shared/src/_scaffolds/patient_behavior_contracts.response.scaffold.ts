// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PatientBehaviorContractsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  pathwayId: z.string().uuid().nullable().optional(),
  triggerText: z.string(),
  commitmentBehavior: z.string(),
  fallbackPlan: z.string(),
  reviewDate: z.string(),
  accountabilityPartner: z.string().max(240).nullable().optional(),
  adherenceStatus: z.string().max(24),
  adherenceNote: z.string().nullable().optional(),
  lastAdherenceCheckAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean(),
  lockVersion: z.number().int(),
  createdByStaffId: z.string().uuid().nullable().optional(),
  updatedByStaffId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PatientBehaviorContractsResponseScaffold = z.infer<typeof PatientBehaviorContractsResponseScaffoldSchema>;

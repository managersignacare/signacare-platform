// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PatientRoutinePlansDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  pathwayId: z.string().uuid().nullable().optional(),
  name: z.string().max(240),
  conditionKind: z.string().max(40),
  conditionThreshold: z.string().regex(/^-?\d{1,8}(\.\d{0,2})?$/).nullable().optional(),
  conditionWindowMinutes: z.number().int(),
  thenActionKind: z.string().max(64),
  thenActionText: z.string(),
  fallbackAfterMinutes: z.number().int().nullable().optional(),
  fallbackActionText: z.string().nullable().optional(),
  reviewDate: z.string(),
  isActive: z.boolean(),
  lockVersion: z.number().int(),
  createdByStaffId: z.string().uuid().nullable().optional(),
  updatedByStaffId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PatientRoutinePlansDtoScaffold = z.infer<typeof PatientRoutinePlansDtoScaffoldSchema>;

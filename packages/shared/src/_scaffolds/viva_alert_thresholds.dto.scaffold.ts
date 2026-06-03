// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const VivaAlertThresholdsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  trackingType: z.string().max(30),
  direction: z.string().max(10),
  threshold: z.string().regex(/^-?\d{1,8}(\.\d{0,2})?$/),
  consecutiveDays: z.number().int(),
  isActive: z.boolean(),
  createdBy: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type VivaAlertThresholdsDtoScaffold = z.infer<typeof VivaAlertThresholdsDtoScaffoldSchema>;

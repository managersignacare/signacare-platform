// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const FeeSchedulesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  itemNumber: z.string().max(20),
  description: z.string().max(500),
  scheduleFeeCents: z.number().int(),
  category: z.string().max(50),
  modality: z.string().max(30).nullable().optional(),
  minDurationMins: z.number().int().nullable().optional(),
  maxDurationMins: z.number().int().nullable().optional(),
  isInitial: z.boolean(),
  isActive: z.boolean(),
  source: z.string().max(20),
  effectiveFrom: z.string().nullable().optional(),
  effectiveTo: z.string().nullable().optional(),
  sortOrder: z.number().int().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type FeeSchedulesDtoScaffold = z.infer<typeof FeeSchedulesDtoScaffoldSchema>;

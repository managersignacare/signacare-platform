// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ChemoCyclesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  planId: z.string().uuid(),
  cycleNumber: z.number().int(),
  plannedDate: z.string(),
  actualDate: z.string().nullable().optional(),
  status: z.string().max(20),
  doseModifications: z.unknown(),
  toxicityCtcae: z.unknown(),
  notes: z.string().nullable().optional(),
  administeredByStaffId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ChemoCyclesDtoScaffold = z.infer<typeof ChemoCyclesDtoScaffoldSchema>;

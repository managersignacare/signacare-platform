// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const BedMovementsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  bedId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  clinicId: z.string().uuid(),
  movementType: z.string().max(30),
  movementAt: z.string().datetime(),
  authorisedById: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable().optional(),
});

export type BedMovementsResponseScaffold = z.infer<typeof BedMovementsResponseScaffoldSchema>;

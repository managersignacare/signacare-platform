// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const BedsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  orgUnitId: z.string().uuid().nullable().optional(),
  ward: z.string().max(100).nullable().optional(),
  room: z.string().max(50).nullable().optional(),
  bedLabel: z.string().max(50),
  bedType: z.string().max(50).nullable().optional(),
  status: z.string().max(30),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type BedsResponseScaffold = z.infer<typeof BedsResponseScaffoldSchema>;

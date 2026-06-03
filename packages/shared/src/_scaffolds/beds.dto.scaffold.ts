// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const BedsDtoScaffoldSchema = z.object({
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

export type BedsDtoScaffold = z.infer<typeof BedsDtoScaffoldSchema>;

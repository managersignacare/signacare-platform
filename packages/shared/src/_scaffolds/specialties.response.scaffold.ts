// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const SpecialtiesResponseScaffoldSchema = z.object({
  code: z.string().max(40),
  display: z.string().max(120),
  system: z.string().max(200),
  snomedCode: z.string().max(20).nullable().optional(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type SpecialtiesResponseScaffold = z.infer<typeof SpecialtiesResponseScaffoldSchema>;

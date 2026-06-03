// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const LegalOrderTypesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  code: z.string().max(50),
  name: z.string().max(200),
  jurisdiction: z.string().max(20),
  maxDurationDays: z.number().int().nullable().optional(),
  requiresTribunal: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type LegalOrderTypesResponseScaffold = z.infer<typeof LegalOrderTypesResponseScaffoldSchema>;

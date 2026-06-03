// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ClinicalTemplatesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  categoryId: z.string().uuid().nullable().optional(),
  name: z.string().max(300),
  type: z.string().max(50),
  description: z.string().nullable().optional(),
  content: z.unknown(),
  isActive: z.boolean(),
  isSystem: z.boolean(),
  sortOrder: z.number().int(),
  createdById: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ClinicalTemplatesResponseScaffold = z.infer<typeof ClinicalTemplatesResponseScaffoldSchema>;

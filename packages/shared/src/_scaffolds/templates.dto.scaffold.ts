// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const TemplatesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  name: z.string().max(255),
  type: z.string().max(50).nullable().optional(),
  description: z.string().nullable().optional(),
  category: z.string().max(100),
  content: z.unknown().nullable().optional(),
  isActive: z.boolean(),
  status: z.string().max(30),
  sortOrder: z.number().int(),
  createdById: z.string().uuid().nullable().optional(),
  publishedAt: z.string().datetime().nullable().optional(),
  retiredAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type TemplatesDtoScaffold = z.infer<typeof TemplatesDtoScaffoldSchema>;

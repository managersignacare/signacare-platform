// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const TemplateSectionsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid(),
  sectionType: z.string().max(50).nullable().optional(),
  label: z.string().max(200).nullable().optional(),
  options: z.unknown().nullable().optional(),
  sortOrder: z.number().int().nullable().optional(),
  isRequired: z.boolean().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type TemplateSectionsResponseScaffold = z.infer<typeof TemplateSectionsResponseScaffoldSchema>;

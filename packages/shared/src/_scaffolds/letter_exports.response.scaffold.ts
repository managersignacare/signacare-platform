// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const LetterExportsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  letterId: z.string().uuid(),
  format: z.string().max(30),
  contentRef: z.string().max(500),
  contentSizeBytes: z.number().int().nullable().optional(),
  generatedBy: z.string().uuid(),
  generatedAt: z.string().datetime(),
});

export type LetterExportsResponseScaffold = z.infer<typeof LetterExportsResponseScaffoldSchema>;

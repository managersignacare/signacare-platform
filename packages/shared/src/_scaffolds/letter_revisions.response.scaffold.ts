// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const LetterRevisionsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  letterId: z.string().uuid(),
  revisionNumber: z.number().int(),
  previousRenderedText: z.string().nullable().optional(),
  reasonCategory: z.string().max(40),
  reasonDetail: z.string(),
  requestedBy: z.string().uuid(),
  createdAt: z.string().datetime(),
});

export type LetterRevisionsResponseScaffold = z.infer<typeof LetterRevisionsResponseScaffoldSchema>;

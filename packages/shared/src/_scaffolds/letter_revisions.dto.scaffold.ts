// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const LetterRevisionsDtoScaffoldSchema = z.object({
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

export type LetterRevisionsDtoScaffold = z.infer<typeof LetterRevisionsDtoScaffoldSchema>;

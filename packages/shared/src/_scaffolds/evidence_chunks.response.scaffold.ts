// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const EvidenceChunksResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  sectionPath: z.string().nullable().optional(),
  chunkIndex: z.number().int(),
  body: z.string(),
  tokenEstimate: z.number().int().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type EvidenceChunksResponseScaffold = z.infer<typeof EvidenceChunksResponseScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const EvidenceChunksDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  sectionPath: z.string().nullable().optional(),
  chunkIndex: z.number().int(),
  body: z.string(),
  tokenEstimate: z.number().int().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type EvidenceChunksDtoScaffold = z.infer<typeof EvidenceChunksDtoScaffoldSchema>;

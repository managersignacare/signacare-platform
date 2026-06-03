// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const EvidenceDocumentsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().max(128),
  title: z.string(),
  publisher: z.string().max(128).nullable().optional(),
  jurisdiction: z.string().max(16).nullable().optional(),
  publishedOn: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  documentType: z.string().max(32),
  license: z.string().nullable().optional(),
  ingestedAt: z.string().datetime(),
});

export type EvidenceDocumentsDtoScaffold = z.infer<typeof EvidenceDocumentsDtoScaffoldSchema>;

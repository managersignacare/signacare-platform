// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const LetterExportsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  letterId: z.string().uuid(),
  format: z.string().max(30),
  contentRef: z.string().max(500),
  contentSizeBytes: z.number().int().nullable().optional(),
  generatedBy: z.string().uuid(),
  generatedAt: z.string().datetime(),
});

export type LetterExportsDtoScaffold = z.infer<typeof LetterExportsDtoScaffoldSchema>;

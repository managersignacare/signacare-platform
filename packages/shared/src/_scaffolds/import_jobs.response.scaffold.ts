// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ImportJobsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  uploadedById: z.string().uuid(),
  kind: z.string().max(40),
  status: z.string().max(20),
  filename: z.string().max(500).nullable().optional(),
  rowCount: z.number().int(),
  errorCount: z.number().int(),
  committedCount: z.number().int(),
  report: z.unknown(),
  uploadedAt: z.string().datetime(),
  committedAt: z.string().datetime().nullable().optional(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type ImportJobsResponseScaffold = z.infer<typeof ImportJobsResponseScaffoldSchema>;

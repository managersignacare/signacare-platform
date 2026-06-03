// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ReportRunsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  requestedById: z.string().uuid(),
  reportType: z.string().max(100),
  filters: z.unknown(),
  format: z.string().max(20),
  status: z.string().max(30),
  totalRows: z.number().int(),
  resultData: z.unknown().nullable().optional(),
  errorMessage: z.string().max(500).nullable().optional(),
  generatedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ReportRunsResponseScaffold = z.infer<typeof ReportRunsResponseScaffoldSchema>;

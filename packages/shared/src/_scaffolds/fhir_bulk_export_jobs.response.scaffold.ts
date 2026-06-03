// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const FhirBulkExportJobsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  requestedByStaffId: z.string().uuid(),
  types: z.unknown(),
  since: z.string().datetime().nullable().optional(),
  requestUrl: z.string(),
  groupId: z.string().nullable().optional(),
  status: z.string().max(16),
  errorText: z.string().nullable().optional(),
  outputFiles: z.unknown(),
  totalResources: z.number().int().nullable().optional(),
  exportedResources: z.number().int(),
  startedAt: z.string().datetime().nullable().optional(),
  finishedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type FhirBulkExportJobsResponseScaffold = z.infer<typeof FhirBulkExportJobsResponseScaffoldSchema>;

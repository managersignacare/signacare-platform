// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PatientMergesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  sourcePatientId: z.string().uuid(),
  destinationPatientId: z.string().uuid(),
  mergedBy: z.string().uuid(),
  reason: z.string(),
  sourceSnapshot: z.unknown(),
  createdAt: z.string().datetime(),
});

export type PatientMergesResponseScaffold = z.infer<typeof PatientMergesResponseScaffoldSchema>;

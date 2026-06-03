// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PacuRecordsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  caseId: z.string().uuid(),
  vitals: z.unknown(),
  aldreteScore: z.unknown(),
  dischargeCriteriaMet: z.boolean(),
  recoveryEndAt: z.string().datetime().nullable().optional(),
  note: z.string().nullable().optional(),
  recordedBy: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type PacuRecordsResponseScaffold = z.infer<typeof PacuRecordsResponseScaffoldSchema>;

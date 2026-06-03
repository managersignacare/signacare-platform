// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const HiErrorLogResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid().nullable().optional(),
  patientId: z.string().uuid().nullable().optional(),
  operation: z.string(),
  statusCode: z.number().int().nullable().optional(),
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string(),
  requestRef: z.string().nullable().optional(),
  context: z.unknown().nullable().optional(),
  createdByStaffId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type HiErrorLogResponseScaffold = z.infer<typeof HiErrorLogResponseScaffoldSchema>;

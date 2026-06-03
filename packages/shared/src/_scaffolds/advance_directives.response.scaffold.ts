// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const AdvanceDirectivesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  clinicId: z.string().uuid(),
  type: z.string().max(100),
  content: z.unknown().nullable().optional(),
  status: z.string().max(30),
  validFrom: z.string().nullable().optional(),
  validUntil: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable().optional(),
  lockVersion: z.number().int(),
});

export type AdvanceDirectivesResponseScaffold = z.infer<typeof AdvanceDirectivesResponseScaffoldSchema>;

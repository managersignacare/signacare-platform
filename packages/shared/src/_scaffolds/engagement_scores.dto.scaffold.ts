// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const EngagementScoresDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  rapport: z.number().int(),
  engagement: z.number().int(),
  compliance: z.number().int(),
  insight: z.number().int(),
  affect: z.number().int(),
  notes: z.string().nullable().optional(),
  recordedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type EngagementScoresDtoScaffold = z.infer<typeof EngagementScoresDtoScaffoldSchema>;

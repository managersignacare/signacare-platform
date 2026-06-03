// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const TnmStageGroupsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  conditionId: z.string().uuid(),
  t: z.string().max(10).nullable().optional(),
  n: z.string().max(10).nullable().optional(),
  m: z.string().max(10).nullable().optional(),
  stageGroup: z.string().max(10).nullable().optional(),
  stagedAt: z.string().datetime(),
  stagedByStaffId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type TnmStageGroupsDtoScaffold = z.infer<typeof TnmStageGroupsDtoScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PlannedTransitionAssignmentsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  transitionId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  toStaffId: z.string().uuid(),
  toTeam: z.string().max(100).nullable().optional(),
  status: z.string().max(30),
  handoverNotes: z.string().nullable().optional(),
  executedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable().optional(),
});

export type PlannedTransitionAssignmentsResponseScaffold = z.infer<typeof PlannedTransitionAssignmentsResponseScaffoldSchema>;

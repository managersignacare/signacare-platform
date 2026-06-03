// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const GroupSessionsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  facilitatorId: z.string().uuid().nullable().optional(),
  name: z.string().max(200),
  groupType: z.string().max(50).nullable().optional(),
  program: z.string().max(100).nullable().optional(),
  sessionDate: z.string(),
  startTime: z.unknown().nullable().optional(),
  endTime: z.unknown().nullable().optional(),
  durationMin: z.number().int().nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.string().max(30),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type GroupSessionsResponseScaffold = z.infer<typeof GroupSessionsResponseScaffoldSchema>;

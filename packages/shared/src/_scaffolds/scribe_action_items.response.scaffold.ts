// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ScribeActionItemsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  sessionId: z.string().uuid(),
  patientId: z.string().uuid(),
  itemType: z.string().max(40),
  description: z.string().max(1000),
  assigneeRole: z.string().max(40).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  status: z.string().max(20),
  downstreamTable: z.string().max(60).nullable().optional(),
  downstreamId: z.string().uuid().nullable().optional(),
  reviewedBy: z.string().uuid().nullable().optional(),
  reviewedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lineageKey: z.string().max(64),
});

export type ScribeActionItemsResponseScaffold = z.infer<typeof ScribeActionItemsResponseScaffoldSchema>;

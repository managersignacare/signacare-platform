// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ReviewPlansResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  planText: z.string(),
  followUpDate: z.string().nullable().optional(),
  followUpType: z.string().max(50).nullable().optional(),
  tasksToCreate: z.unknown().nullable().optional(),
  generateLetter: z.boolean(),
  letterType: z.string().max(50).nullable().optional(),
  letterRecipient: z.string().max(200).nullable().optional(),
  letterJobId: z.string().uuid().nullable().optional(),
  tasksCreated: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type ReviewPlansResponseScaffold = z.infer<typeof ReviewPlansResponseScaffoldSchema>;

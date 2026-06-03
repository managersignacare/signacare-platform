// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const CapacityAssessmentsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  assessorId: z.string().uuid(),
  letterId: z.string().uuid().nullable().optional(),
  decisionContext: z.string().max(200),
  understandNotes: z.string(),
  retainNotes: z.string(),
  weighNotes: z.string(),
  communicateNotes: z.string(),
  conclusion: z.string().max(30),
  conclusionReasoning: z.string(),
  assessedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type CapacityAssessmentsResponseScaffold = z.infer<typeof CapacityAssessmentsResponseScaffoldSchema>;

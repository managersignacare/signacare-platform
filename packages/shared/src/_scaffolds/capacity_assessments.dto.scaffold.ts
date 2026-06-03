// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const CapacityAssessmentsDtoScaffoldSchema = z.object({
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

export type CapacityAssessmentsDtoScaffold = z.infer<typeof CapacityAssessmentsDtoScaffoldSchema>;

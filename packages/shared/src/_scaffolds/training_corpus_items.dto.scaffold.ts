// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const TrainingCorpusItemsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  sourceClinicId: z.string().uuid(),
  sourceSessionId: z.string().uuid().nullable().optional(),
  scrubberVersion: z.string().max(40),
  sanitisedTranscript: z.string(),
  redactionSummary: z.unknown(),
  status: z.string().max(20),
  reviewedBy: z.string().uuid().nullable().optional(),
  reviewedAt: z.string().datetime().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type TrainingCorpusItemsDtoScaffold = z.infer<typeof TrainingCorpusItemsDtoScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PsychologySessionNotesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  staffId: z.string().uuid(),
  sessionDate: z.string(),
  durationMin: z.number().int().nullable().optional(),
  sessionType: z.string().max(60).nullable().optional(),
  content: z.string().nullable().optional(),
  outcomeScores: z.unknown().nullable().optional(),
  sharedWithClinicians: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type PsychologySessionNotesResponseScaffold = z.infer<typeof PsychologySessionNotesResponseScaffoldSchema>;

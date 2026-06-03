// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const RestrictiveInterventionsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  interventionType: z.string().max(100).nullable().optional(),
  startTime: z.string().datetime().nullable().optional(),
  endTime: z.string().datetime().nullable().optional(),
  durationMinutes: z.number().int().nullable().optional(),
  reason: z.string().nullable().optional(),
  authorisedById: z.string().uuid().nullable().optional(),
  recordedById: z.string().uuid().nullable().optional(),
  outcome: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable().optional(),
  alternativesTried: z.string().nullable().optional(),
  debriefCompleted: z.boolean(),
  debriefNotes: z.string().nullable().optional(),
  notifiedPersons: z.unknown().nullable().optional(),
  lockVersion: z.number().int(),
});

export type RestrictiveInterventionsDtoScaffold = z.infer<typeof RestrictiveInterventionsDtoScaffoldSchema>;

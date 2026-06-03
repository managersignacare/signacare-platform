// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const DevelopmentalMilestonesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  domain: z.string().max(20),
  milestone: z.string().max(200),
  expectedAgeMonths: z.unknown().nullable().optional(),
  achievedAtMonths: z.unknown().nullable().optional(),
  status: z.string().max(20),
  note: z.string().nullable().optional(),
  assessedAt: z.string().datetime(),
  assessedBy: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type DevelopmentalMilestonesDtoScaffold = z.infer<typeof DevelopmentalMilestonesDtoScaffoldSchema>;

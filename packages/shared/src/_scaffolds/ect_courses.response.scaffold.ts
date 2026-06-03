// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const EctCoursesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  treatingPsychiatristId: z.string().uuid(),
  anaesthetistId: z.string().uuid().nullable().optional(),
  consentObtained: z.boolean(),
  consentDate: z.string().datetime().nullable().optional(),
  consentRecordedBy: z.string().uuid().nullable().optional(),
  totalPlannedSessions: z.number().int(),
  indication: z.string().max(255),
  status: z.string().max(30),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type EctCoursesResponseScaffold = z.infer<typeof EctCoursesResponseScaffoldSchema>;

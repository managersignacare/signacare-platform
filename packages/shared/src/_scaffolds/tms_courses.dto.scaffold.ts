// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const TmsCoursesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  treatingPsychiatristId: z.string().uuid(),
  protocol: z.string().max(30),
  targetArea: z.string().max(100),
  totalPlannedSessions: z.number().int(),
  motorThresholdPercent: z.number().int().nullable().optional(),
  consentObtained: z.boolean(),
  consentDate: z.string().datetime().nullable().optional(),
  consentRecordedBy: z.string().uuid().nullable().optional(),
  indication: z.string().max(255),
  status: z.string().max(30),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type TmsCoursesDtoScaffold = z.infer<typeof TmsCoursesDtoScaffoldSchema>;

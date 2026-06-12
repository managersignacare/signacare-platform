// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const OutcomeMeasuresResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  clinicId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  staffId: z.string().uuid().nullable().optional(),
  measureType: z.string().max(100),
  collectionOccasion: z.string().max(50).nullable().optional(),
  totalScore: z.string().regex(/^-?\d{1,6}(\.\d{0,2})?$/).nullable().optional(),
  items: z.unknown().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable().optional(),
  status: z.string().max(20).nullable().optional(),
  assignedForPatient: z.boolean().nullable().optional(),
  templateId: z.string().uuid().nullable().optional(),
  templateName: z.string().max(255).nullable().optional(),
  assignedBy: z.string().uuid().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  lockVersion: z.number().int(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type OutcomeMeasuresResponseScaffold = z.infer<typeof OutcomeMeasuresResponseScaffoldSchema>;

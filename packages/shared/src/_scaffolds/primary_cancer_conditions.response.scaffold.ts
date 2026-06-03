// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PrimaryCancerConditionsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  icd10: z.string().max(20).nullable().optional(),
  snomed: z.string().max(30).nullable().optional(),
  histology: z.string().max(200).nullable().optional(),
  laterality: z.string().max(20).nullable().optional(),
  diagnosisDate: z.string(),
  stageSystem: z.string().max(10).nullable().optional(),
  notes: z.string().nullable().optional(),
  createdByStaffId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type PrimaryCancerConditionsResponseScaffold = z.infer<typeof PrimaryCancerConditionsResponseScaffoldSchema>;

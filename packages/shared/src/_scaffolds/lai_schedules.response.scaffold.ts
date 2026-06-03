// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const LaiSchedulesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  drugProductId: z.string().uuid().nullable().optional(),
  prescriberStaffId: z.string().uuid(),
  drugName: z.string().max(300),
  doseMg: z.string().max(50),
  frequencyDays: z.number().int(),
  injectionSite: z.string().max(50),
  injectionTechnique: z.string().max(20),
  needleGauge: z.string().max(20).nullable().optional(),
  indication: z.string().nullable().optional(),
  loadingDoseRequired: z.boolean(),
  loadingDosesRequired: z.number().int(),
  loadingDosesGiven: z.number().int(),
  oralOverlapRequired: z.boolean(),
  oralOverlapEndDate: z.string().nullable().optional(),
  startDate: z.string(),
  firstDueDate: z.string(),
  nextDueDate: z.string().nullable().optional(),
  lastGivenDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  baselineAimsScore: z.number().int().nullable().optional(),
  lastAimsDate: z.string().nullable().optional(),
  nextAimsDueDate: z.string().nullable().optional(),
  status: z.string().max(30),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type LaiSchedulesResponseScaffold = z.infer<typeof LaiSchedulesResponseScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PatientDigitalPhenotypesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  computationDay: z.string(),
  lookbackDays: z.number().int(),
  sleepHoursAvg7d: z.string().regex(/^-?\d{1,5}(\.\d{0,2})?$/).nullable().optional(),
  stepsAvg7d: z.string().regex(/^-?\d{1,8}(\.\d{0,2})?$/).nullable().optional(),
  restingHrAvg7d: z.string().regex(/^-?\d{1,5}(\.\d{0,2})?$/).nullable().optional(),
  hrvAvg7d: z.string().regex(/^-?\d{1,8}(\.\d{0,2})?$/).nullable().optional(),
  moodAvg7d: z.string().regex(/^-?\d{1,5}(\.\d{0,2})?$/).nullable().optional(),
  anxietyAvg7d: z.string().regex(/^-?\d{1,5}(\.\d{0,2})?$/).nullable().optional(),
  adherenceScore: z.string().regex(/^-?\d{1,5}(\.\d{0,2})?$/),
  riskIndex: z.string().regex(/^-?\d{1,5}(\.\d{0,2})?$/),
  riskBand: z.string().max(20),
  contributingSignals: z.unknown(),
  lockVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PatientDigitalPhenotypesDtoScaffold = z.infer<typeof PatientDigitalPhenotypesDtoScaffoldSchema>;

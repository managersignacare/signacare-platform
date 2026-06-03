// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ClozapineObservationsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  registrationId: z.string().uuid(),
  observationDate: z.string(),
  observationTime: z.string().max(5).nullable().optional(),
  temperature: z.string().regex(/^-?\d{1,3}(\.\d{0,1})?$/).nullable().optional(),
  pulse: z.number().int().nullable().optional(),
  bpSystolicLying: z.number().int().nullable().optional(),
  bpDiastolicLying: z.number().int().nullable().optional(),
  bpSystolicStanding: z.number().int().nullable().optional(),
  bpDiastolicStanding: z.number().int().nullable().optional(),
  respirationRate: z.number().int().nullable().optional(),
  smokingStatus: z.string().max(30).nullable().optional(),
  cigarettesPerDay: z.number().int().nullable().optional(),
  outsideNormal: z.boolean(),
  notes: z.string().nullable().optional(),
  recordedByStaffId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type ClozapineObservationsDtoScaffold = z.infer<typeof ClozapineObservationsDtoScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ImmunizationsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  cvxCode: z.string().max(10),
  vaccineName: z.string().max(200),
  manufacturer: z.string().max(100).nullable().optional(),
  seriesName: z.string().max(100).nullable().optional(),
  doseNumber: z.unknown().nullable().optional(),
  seriesDoses: z.unknown().nullable().optional(),
  administeredDate: z.string(),
  lotNumber: z.string().max(50).nullable().optional(),
  expirationDate: z.string().nullable().optional(),
  site: z.string().max(30).nullable().optional(),
  route: z.string().max(10).nullable().optional(),
  doseQuantityMl: z.string().regex(/^-?\d{1,3}(\.\d{0,2})?$/).nullable().optional(),
  status: z.string().max(20),
  notDoneReason: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  administeredBy: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type ImmunizationsDtoScaffold = z.infer<typeof ImmunizationsDtoScaffoldSchema>;

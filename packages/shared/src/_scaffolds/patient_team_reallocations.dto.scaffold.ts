// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PatientTeamReallocationsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  toOrgUnitId: z.string().uuid(),
  toPrimaryClinicianId: z.string().uuid().nullable().optional(),
  fromOrgUnitId: z.string().uuid().nullable().optional(),
  status: z.string().max(30),
  referredById: z.string().uuid(),
  reviewedById: z.string().uuid().nullable().optional(),
  reviewedAt: z.string().datetime().nullable().optional(),
  reason: z.string().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PatientTeamReallocationsDtoScaffold = z.infer<typeof PatientTeamReallocationsDtoScaffoldSchema>;

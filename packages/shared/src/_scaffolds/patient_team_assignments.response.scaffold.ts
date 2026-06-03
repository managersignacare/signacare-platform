// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PatientTeamAssignmentsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  orgUnitId: z.string().uuid(),
  primaryClinicianId: z.string().uuid().nullable().optional(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable().optional(),
  referralStatus: z.string().max(40),
  reviewedById: z.string().uuid().nullable().optional(),
  reviewedAt: z.string().datetime().nullable().optional(),
  referredById: z.string().uuid().nullable().optional(),
  escalationId: z.string().uuid().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
});

export type PatientTeamAssignmentsResponseScaffold = z.infer<typeof PatientTeamAssignmentsResponseScaffoldSchema>;

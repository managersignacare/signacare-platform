// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ClinicianAvailabilityBlocksResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  clinicianId: z.string().uuid(),
  colour: z.string().max(10),
  recurrence: z.string().max(10),
  dayOfWeek: z.unknown().nullable().optional(),
  specificDate: z.string().nullable().optional(),
  startTime: z.unknown(),
  endTime: z.unknown(),
  effectiveFrom: z.string(),
  effectiveUntil: z.string().nullable().optional(),
  label: z.string().max(200).nullable().optional(),
  notes: z.string().nullable().optional(),
  createdByStaffId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type ClinicianAvailabilityBlocksResponseScaffold = z.infer<typeof ClinicianAvailabilityBlocksResponseScaffoldSchema>;

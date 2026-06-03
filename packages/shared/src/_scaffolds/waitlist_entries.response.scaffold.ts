// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const WaitlistEntriesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  referralId: z.string().uuid().nullable().optional(),
  preferredClinicianId: z.string().uuid().nullable().optional(),
  priority: z.string().max(30),
  preferredTimeOfDay: z.string().max(50).nullable().optional(),
  preferredStartTime: z.unknown().nullable().optional(),
  preferredEndTime: z.unknown().nullable().optional(),
  addedDate: z.string(),
  targetAppointmentBy: z.string().nullable().optional(),
  status: z.string().max(30),
  convertedAppointmentId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type WaitlistEntriesResponseScaffold = z.infer<typeof WaitlistEntriesResponseScaffoldSchema>;

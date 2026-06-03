// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const AppointmentChecklistsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  appointmentId: z.string().uuid().nullable().optional(),
  item: z.string().max(500),
  isCompleted: z.boolean(),
  sortOrder: z.number().int(),
  createdBy: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type AppointmentChecklistsDtoScaffold = z.infer<typeof AppointmentChecklistsDtoScaffoldSchema>;

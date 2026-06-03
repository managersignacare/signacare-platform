// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const AppointmentAttendeesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  appointmentId: z.string().uuid(),
  staffId: z.string().uuid(),
  role: z.string().max(20),
  attendanceStatus: z.string().max(20),
  invitedAt: z.string().datetime(),
  respondedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AppointmentAttendeesDtoScaffold = z.infer<typeof AppointmentAttendeesDtoScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ClozapineAdministrationsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  registrationId: z.string().uuid(),
  titrationDayId: z.string().uuid().nullable().optional(),
  administrationDate: z.string(),
  timeSlot: z.string().max(10),
  actualTime: z.string().max(5).nullable().optional(),
  doseMg: z.string().regex(/^-?\d{1,5}(\.\d{0,1})?$/),
  administered: z.boolean(),
  nonAdminCode: z.string().max(2).nullable().optional(),
  administeredByStaffId: z.string().uuid().nullable().optional(),
  administratorInitials: z.string().max(10).nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type ClozapineAdministrationsDtoScaffold = z.infer<typeof ClozapineAdministrationsDtoScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ClozapineTitrationDaysDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  registrationId: z.string().uuid(),
  dayNumber: z.number().int(),
  titrationDate: z.string(),
  morningDoseMg: z.string().regex(/^-?\d{1,5}(\.\d{0,1})?$/).nullable().optional(),
  eveningDoseMg: z.string().regex(/^-?\d{1,5}(\.\d{0,1})?$/).nullable().optional(),
  prescriberInitials: z.string().max(10).nullable().optional(),
  prescribedByStaffId: z.string().uuid().nullable().optional(),
  comments: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ClozapineTitrationDaysDtoScaffold = z.infer<typeof ClozapineTitrationDaysDtoScaffoldSchema>;

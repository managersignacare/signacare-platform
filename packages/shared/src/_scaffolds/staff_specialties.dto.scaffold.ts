// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const StaffSpecialtiesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  staffId: z.string().uuid(),
  specialtyCode: z.string().max(40),
  isPrimary: z.boolean(),
  credentialRef: z.string().max(200).nullable().optional(),
  createdAt: z.string().datetime(),
  createdBy: z.string().uuid().nullable().optional(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type StaffSpecialtiesDtoScaffold = z.infer<typeof StaffSpecialtiesDtoScaffoldSchema>;

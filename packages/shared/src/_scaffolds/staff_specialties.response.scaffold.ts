// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const StaffSpecialtiesResponseScaffoldSchema = z.object({
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

export type StaffSpecialtiesResponseScaffold = z.infer<typeof StaffSpecialtiesResponseScaffoldSchema>;

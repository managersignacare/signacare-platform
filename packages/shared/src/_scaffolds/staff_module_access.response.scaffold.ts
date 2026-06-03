// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const StaffModuleAccessResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  staffId: z.string().uuid(),
  clinicId: z.string().uuid(),
  module: z.string().max(100),
  accessLevel: z.string().max(30),
  grantedById: z.string().uuid().nullable().optional(),
  canDelegateThis: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type StaffModuleAccessResponseScaffold = z.infer<typeof StaffModuleAccessResponseScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const AdminImpersonationSessionsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  adminId: z.string().uuid(),
  impersonatedStaffId: z.string().uuid(),
  reason: z.string().max(500),
  startedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type AdminImpersonationSessionsResponseScaffold = z.infer<typeof AdminImpersonationSessionsResponseScaffoldSchema>;

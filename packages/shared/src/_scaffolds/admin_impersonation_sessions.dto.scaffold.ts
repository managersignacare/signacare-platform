// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const AdminImpersonationSessionsDtoScaffoldSchema = z.object({
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

export type AdminImpersonationSessionsDtoScaffold = z.infer<typeof AdminImpersonationSessionsDtoScaffoldSchema>;

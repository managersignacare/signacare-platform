// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const StaffSessionsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  staffId: z.string().uuid(),
  clinicId: z.string().uuid(),
  refreshToken: z.string().max(500),
  userAgent: z.string().max(500).nullable().optional(),
  ipAddress: z.string().max(50).nullable().optional(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable().optional(),
  familyId: z.string().uuid(),
  lockVersion: z.number().int(),
});

export type StaffSessionsResponseScaffold = z.infer<typeof StaffSessionsResponseScaffoldSchema>;

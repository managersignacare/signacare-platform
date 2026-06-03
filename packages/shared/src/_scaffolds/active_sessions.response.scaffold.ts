// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ActiveSessionsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  staffId: z.string().uuid(),
  clinicId: z.string().uuid(),
  refreshTokenJti: z.string().max(64),
  ipAddress: z.string().max(45).nullable().optional(),
  userAgent: z.string().max(500).nullable().optional(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable().optional(),
});

export type ActiveSessionsResponseScaffold = z.infer<typeof ActiveSessionsResponseScaffoldSchema>;

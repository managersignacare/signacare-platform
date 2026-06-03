// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const BreakGlassSessionsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  staffId: z.string().uuid(),
  reason: z.string(),
  status: z.string(),
  approverId: z.string().uuid().nullable().optional(),
  approvedAt: z.string().datetime().nullable().optional(),
  deniedReason: z.string().nullable().optional(),
  tokenHash: z.string().nullable().optional(),
  issuedAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  revokedAt: z.string().datetime().nullable().optional(),
  revokedBy: z.string().uuid().nullable().optional(),
  ipAddress: z.unknown().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  actionsPerformed: z.unknown().nullable().optional(),
  alertedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type BreakGlassSessionsResponseScaffold = z.infer<typeof BreakGlassSessionsResponseScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PasswordResetTokensResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  staffId: z.string().uuid(),
  tokenHash: z.string().max(128),
  expiresAt: z.string().datetime(),
  usedAt: z.string().datetime().nullable().optional(),
  requestedIp: z.string().max(120).nullable().optional(),
  requestedUserAgent: z.string().max(255).nullable().optional(),
  createdAt: z.string().datetime(),
});

export type PasswordResetTokensResponseScaffold = z.infer<typeof PasswordResetTokensResponseScaffoldSchema>;

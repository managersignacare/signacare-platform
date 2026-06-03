// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const OauthRefreshTokensResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  tokenHash: z.string().max(64),
  clientId: z.string().max(100),
  clinicId: z.string().uuid(),
  userId: z.string().uuid(),
  patientId: z.string().uuid().nullable().optional(),
  scopes: z.unknown(),
  rotatedToId: z.string().uuid().nullable().optional(),
  expiresAt: z.string().datetime(),
  issuedAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable().optional(),
});

export type OauthRefreshTokensResponseScaffold = z.infer<typeof OauthRefreshTokensResponseScaffoldSchema>;

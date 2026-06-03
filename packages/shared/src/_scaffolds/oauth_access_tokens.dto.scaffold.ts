// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const OauthAccessTokensDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  jti: z.string().max(64),
  clientId: z.string().max(100),
  clinicId: z.string().uuid(),
  userId: z.string().uuid(),
  patientId: z.string().uuid().nullable().optional(),
  scopes: z.unknown(),
  expiresAt: z.string().datetime(),
  issuedAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable().optional(),
  revokedReason: z.string().nullable().optional(),
});

export type OauthAccessTokensDtoScaffold = z.infer<typeof OauthAccessTokensDtoScaffoldSchema>;

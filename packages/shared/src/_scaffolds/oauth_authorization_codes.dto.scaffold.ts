// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const OauthAuthorizationCodesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  codeHash: z.string().max(64),
  clientId: z.string().max(100),
  clinicId: z.string().uuid(),
  userId: z.string().uuid(),
  patientId: z.string().uuid().nullable().optional(),
  redirectUri: z.string(),
  scopes: z.unknown(),
  codeChallenge: z.string().max(128).nullable().optional(),
  codeChallengeMethod: z.string().max(10).nullable().optional(),
  launchToken: z.string().max(64).nullable().optional(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  redeemedAt: z.string().datetime().nullable().optional(),
});

export type OauthAuthorizationCodesDtoScaffold = z.infer<typeof OauthAuthorizationCodesDtoScaffoldSchema>;

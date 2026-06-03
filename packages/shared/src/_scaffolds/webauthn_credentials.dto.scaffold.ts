// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const WebauthnCredentialsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  staffId: z.string().uuid(),
  clinicId: z.string().uuid(),
  credentialId: z.string(),
  publicKey: z.string(),
  counter: z.number().int(),
  transports: z.unknown().nullable().optional(),
  deviceName: z.string().nullable().optional(),
  aaguid: z.string().nullable().optional(),
  backupEligible: z.boolean(),
  backupState: z.boolean(),
  lastUsedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type WebauthnCredentialsDtoScaffold = z.infer<typeof WebauthnCredentialsDtoScaffoldSchema>;

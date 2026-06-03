// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const SmartLaunchContextsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  launchToken: z.string().max(64),
  clientId: z.string().max(100),
  clinicId: z.string().uuid(),
  userId: z.string().uuid(),
  patientId: z.string().uuid().nullable().optional(),
  encounterId: z.string().uuid().nullable().optional(),
  scopes: z.unknown(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  consumedAt: z.string().datetime().nullable().optional(),
});

export type SmartLaunchContextsDtoScaffold = z.infer<typeof SmartLaunchContextsDtoScaffoldSchema>;

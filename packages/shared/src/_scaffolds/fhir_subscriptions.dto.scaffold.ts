// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const FhirSubscriptionsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  status: z.string().max(30).nullable().optional(),
  criteria: z.string().max(500),
  channelType: z.string().max(30),
  channelEndpoint: z.string().max(1000),
  channelHeader: z.unknown().nullable().optional(),
  channelPayload: z.string().max(30).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
  endTime: z.string().datetime().nullable().optional(),
  createdById: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type FhirSubscriptionsDtoScaffold = z.infer<typeof FhirSubscriptionsDtoScaffoldSchema>;

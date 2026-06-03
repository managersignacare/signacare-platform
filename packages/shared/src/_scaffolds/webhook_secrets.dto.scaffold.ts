// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const WebhookSecretsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  source: z.string().max(100),
  hmacSecret: z.string(),
  signatureHeader: z.string().max(100),
  timestampHeader: z.string().max(100).nullable().optional(),
  replayWindowSeconds: z.number().int(),
  rateLimitPerMinute: z.number().int(),
  ipAllowlist: z.string().nullable().optional(),
  queueName: z.string().max(100),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type WebhookSecretsDtoScaffold = z.infer<typeof WebhookSecretsDtoScaffoldSchema>;

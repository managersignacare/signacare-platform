// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const WebhookAuditLogDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid().nullable().optional(),
  source: z.string().max(100),
  payloadHash: z.string().max(64),
  nonce: z.string().max(128).nullable().optional(),
  outcome: z.string().max(32),
  errorText: z.string().nullable().optional(),
  jobId: z.string().max(100).nullable().optional(),
  bodySize: z.number().int().nullable().optional(),
  sourceIp: z.string().max(64).nullable().optional(),
  receivedAt: z.string().datetime(),
});

export type WebhookAuditLogDtoScaffold = z.infer<typeof WebhookAuditLogDtoScaffoldSchema>;

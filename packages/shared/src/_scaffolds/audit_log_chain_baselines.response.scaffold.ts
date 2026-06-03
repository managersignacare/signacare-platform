// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const AuditLogChainBaselinesResponseScaffoldSchema = z.object({
  scopeKey: z.string(),
  baselineMarker: z.string(),
  markerSignature: z.string().max(64),
  sourceRowCount: z.number().int(),
  minCreatedAt: z.string().datetime().nullable().optional(),
  maxCreatedAt: z.string().datetime().nullable().optional(),
  computedAt: z.string().datetime(),
});

export type AuditLogChainBaselinesResponseScaffold = z.infer<typeof AuditLogChainBaselinesResponseScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const FeatureFlagDisableRequestsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid().nullable().optional(),
  flagName: z.string().max(100),
  action: z.string().max(20),
  requestedById: z.string().uuid(),
  requestedAt: z.string().datetime(),
  approvedById: z.string().uuid().nullable().optional(),
  approvedAt: z.string().datetime().nullable().optional(),
  status: z.string().max(20),
  reason: z.string().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type FeatureFlagDisableRequestsDtoScaffold = z.infer<typeof FeatureFlagDisableRequestsDtoScaffoldSchema>;

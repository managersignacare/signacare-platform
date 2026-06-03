// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ModelDeploymentsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  modelId: z.string().uuid(),
  status: z.string().max(20),
  trafficPercentage: z.number().int(),
  deployedBy: z.string().uuid(),
  deployedAt: z.string().datetime(),
  promotedAt: z.string().datetime().nullable().optional(),
  rolledBackAt: z.string().datetime().nullable().optional(),
  rollbackReason: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ModelDeploymentsResponseScaffold = z.infer<typeof ModelDeploymentsResponseScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ModelSurveillanceEventsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  sourceClinicId: z.string().uuid(),
  deploymentId: z.string().uuid().nullable().optional(),
  modelId: z.string().uuid().nullable().optional(),
  eventType: z.string().max(40),
  severity: z.string().max(20),
  payload: z.unknown().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type ModelSurveillanceEventsDtoScaffold = z.infer<typeof ModelSurveillanceEventsDtoScaffoldSchema>;

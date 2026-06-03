// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ModelRegistryResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  modelKind: z.string().max(40),
  name: z.string().max(200),
  version: z.string().max(100),
  provider: z.string().max(40),
  digestSha256: z.string().max(64).nullable().optional(),
  evalScores: z.unknown().nullable().optional(),
  redTeamPass: z.boolean(),
  redTeamReportRef: z.string().nullable().optional(),
  registeredBy: z.string().uuid(),
  registeredAt: z.string().datetime(),
  isActive: z.boolean(),
});

export type ModelRegistryResponseScaffold = z.infer<typeof ModelRegistryResponseScaffoldSchema>;

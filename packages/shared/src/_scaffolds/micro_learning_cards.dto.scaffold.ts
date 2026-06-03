// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const MicroLearningCardsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  cardKey: z.string().max(120),
  title: z.string().max(240),
  body: z.string(),
  estimatedMinutes: z.number().int(),
  tags: z.unknown(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type MicroLearningCardsDtoScaffold = z.infer<typeof MicroLearningCardsDtoScaffoldSchema>;

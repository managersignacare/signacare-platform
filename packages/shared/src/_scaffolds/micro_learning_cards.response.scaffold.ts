// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const MicroLearningCardsResponseScaffoldSchema = z.object({
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

export type MicroLearningCardsResponseScaffold = z.infer<typeof MicroLearningCardsResponseScaffoldSchema>;

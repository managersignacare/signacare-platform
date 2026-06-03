// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PhiScrubberRulesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid().nullable().optional(),
  category: z.string().max(40),
  name: z.string().max(200),
  pattern: z.string(),
  replacement: z.string().max(100),
  precedence: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PhiScrubberRulesResponseScaffold = z.infer<typeof PhiScrubberRulesResponseScaffoldSchema>;

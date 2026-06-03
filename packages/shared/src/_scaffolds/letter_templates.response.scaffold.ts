// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const LetterTemplatesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid().nullable().optional(),
  code: z.string().max(60),
  name: z.string().max(200),
  category: z.string().max(40),
  description: z.string().nullable().optional(),
  sections: z.unknown(),
  systemPrompt: z.string(),
  defaultRecipients: z.unknown().nullable().optional(),
  isActive: z.boolean(),
  requiresSecondReview: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type LetterTemplatesResponseScaffold = z.infer<typeof LetterTemplatesResponseScaffoldSchema>;

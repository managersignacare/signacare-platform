// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const LetterTranslationsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  letterId: z.string().uuid(),
  languageCode: z.string().max(5),
  translatedText: z.string(),
  translatorModel: z.string().max(100),
  translatedBy: z.string().uuid(),
  translatedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export type LetterTranslationsResponseScaffold = z.infer<typeof LetterTranslationsResponseScaffoldSchema>;

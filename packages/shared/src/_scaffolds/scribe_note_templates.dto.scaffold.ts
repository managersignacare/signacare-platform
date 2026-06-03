// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ScribeNoteTemplatesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid().nullable().optional(),
  variant: z.string().max(40),
  name: z.string().max(200),
  systemPrompt: z.string(),
  userPromptTemplate: z.string(),
  sections: z.unknown(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ScribeNoteTemplatesDtoScaffold = z.infer<typeof ScribeNoteTemplatesDtoScaffoldSchema>;

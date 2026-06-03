// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const AiModelfilesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  actionType: z.string().max(50),
  modelName: z.string().max(100),
  modelfileContent: z.string().nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
  temperature: z.string().regex(/^-?\d{1,1}(\.\d{0,2})?$/),
  maxTokens: z.number().int(),
  fewShotExamples: z.string().nullable().optional(),
  ragInstructions: z.string().nullable().optional(),
  isActive: z.boolean(),
  updatedByStaffId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AiModelfilesResponseScaffold = z.infer<typeof AiModelfilesResponseScaffoldSchema>;

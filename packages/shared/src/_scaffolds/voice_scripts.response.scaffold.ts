// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const VoiceScriptsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  name: z.string().max(200),
  description: z.string().nullable().optional(),
  scriptType: z.string().max(50),
  version: z.number().int(),
  content: z.string(),
  isActive: z.boolean(),
  createdById: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type VoiceScriptsResponseScaffold = z.infer<typeof VoiceScriptsResponseScaffoldSchema>;

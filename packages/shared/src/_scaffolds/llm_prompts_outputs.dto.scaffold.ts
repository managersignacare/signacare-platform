// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const LlmPromptsOutputsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  llmInteractionId: z.string().uuid(),
  promptEncrypted: z.string().nullable().optional(),
  outputEncrypted: z.string().nullable().optional(),
  encryptionStatus: z.string().max(16),
  consentId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type LlmPromptsOutputsDtoScaffold = z.infer<typeof LlmPromptsOutputsDtoScaffoldSchema>;

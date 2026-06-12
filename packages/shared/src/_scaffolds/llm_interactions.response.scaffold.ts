// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const LlmInteractionsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  userId: z.string().uuid().nullable().optional(),
  patientId: z.string().uuid().nullable().optional(),
  episodeId: z.string().uuid().nullable().optional(),
  feature: z.string().max(50),
  modelName: z.string().max(100),
  modelProvider: z.string().max(50).nullable().optional(),
  promptTokens: z.number().int().nullable().optional(),
  completionTokens: z.number().int().nullable().optional(),
  totalTokens: z.number().int().nullable().optional(),
  latencyMs: z.number().int().nullable().optional(),
  success: z.boolean(),
  errorCode: z.string().max(50).nullable().optional(),
  inputRef: z.string().max(200).nullable().optional(),
  outputRef: z.string().max(200).nullable().optional(),
  metadata: z.unknown().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable().optional(),
  embedding: z.unknown().nullable().optional(),
  modelVersion: z.string().nullable().optional(),
  temperature: z.string().regex(/^-?\d{1,2}(\.\d{0,3})?$/).nullable().optional(),
  pipeline: z.unknown().nullable().optional(),
});

export type LlmInteractionsResponseScaffold = z.infer<typeof LlmInteractionsResponseScaffoldSchema>;

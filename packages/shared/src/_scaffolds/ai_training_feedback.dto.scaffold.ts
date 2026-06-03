// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const AiTrainingFeedbackDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  staffId: z.string().uuid().nullable().optional(),
  interactionId: z.string().uuid().nullable().optional(),
  feedbackType: z.string().max(50).nullable().optional(),
  rating: z.number().int().nullable().optional(),
  comments: z.string().nullable().optional(),
  originalOutput: z.string().nullable().optional(),
  correctedOutput: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable().optional(),
});

export type AiTrainingFeedbackDtoScaffold = z.infer<typeof AiTrainingFeedbackDtoScaffoldSchema>;

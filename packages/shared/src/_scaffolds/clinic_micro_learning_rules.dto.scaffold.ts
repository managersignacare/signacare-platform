// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ClinicMicroLearningRulesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  name: z.string().max(240),
  trackingType: z.string().max(40),
  deltaThreshold: z.string().regex(/^-?\d{1,8}(\.\d{0,2})?$/),
  windowDays: z.number().int(),
  cardId: z.string().uuid(),
  cooldownDays: z.number().int(),
  isActive: z.boolean(),
  lockVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ClinicMicroLearningRulesDtoScaffold = z.infer<typeof ClinicMicroLearningRulesDtoScaffoldSchema>;

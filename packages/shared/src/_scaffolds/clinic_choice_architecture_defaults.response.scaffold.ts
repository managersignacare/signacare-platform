// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ClinicChoiceArchitectureDefaultsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  nextReviewDueDaysDefault: z.number().int(),
  safetyPlanRefreshDaysDefault: z.number().int(),
  medicationReminderWindowMinutes: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ClinicChoiceArchitectureDefaultsResponseScaffold = z.infer<typeof ClinicChoiceArchitectureDefaultsResponseScaffoldSchema>;

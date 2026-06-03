// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const StepCareRuleEventsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  ruleId: z.string().uuid(),
  patientId: z.string().uuid(),
  pathwayId: z.string().uuid().nullable().optional(),
  eventType: z.string().max(40),
  fingerprint: z.string().max(255),
  details: z.unknown(),
  createdAt: z.string().datetime(),
});

export type StepCareRuleEventsResponseScaffold = z.infer<typeof StepCareRuleEventsResponseScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ClinicStepCareRulesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  name: z.string().max(160),
  description: z.string().nullable().optional(),
  pathwayType: z.string().max(80),
  interventionTemplateKey: z.string().max(80),
  autoAssignEnabled: z.boolean(),
  autoEscalateEnabled: z.boolean(),
  escalationPriority: z.string().max(20),
  assignmentScope: z.string().max(40),
  isActive: z.boolean(),
  expectedOutcomeText: z.string().nullable().optional(),
  conditions: z.unknown(),
  createdByStaffId: z.string().uuid().nullable().optional(),
  lockVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ClinicStepCareRulesResponseScaffold = z.infer<typeof ClinicStepCareRulesResponseScaffoldSchema>;

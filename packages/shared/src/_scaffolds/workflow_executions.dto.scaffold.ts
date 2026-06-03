// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const WorkflowExecutionsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  workflowId: z.string().uuid(),
  triggerData: z.unknown().nullable().optional(),
  status: z.string().max(30),
  stepsCompleted: z.number().int(),
  totalSteps: z.number().int(),
  errorMessage: z.string().nullable().optional(),
  stepResults: z.unknown().nullable().optional(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable().optional(),
});

export type WorkflowExecutionsDtoScaffold = z.infer<typeof WorkflowExecutionsDtoScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const SafetyChecklistsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  caseId: z.string().uuid(),
  phase: z.string().max(20),
  items: z.unknown(),
  completedBy: z.string().uuid().nullable().optional(),
  completedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type SafetyChecklistsDtoScaffold = z.infer<typeof SafetyChecklistsDtoScaffoldSchema>;

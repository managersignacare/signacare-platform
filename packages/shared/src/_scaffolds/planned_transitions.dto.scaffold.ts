// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PlannedTransitionsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  fromStaffId: z.string().uuid(),
  reason: z.string().max(200),
  effectiveDate: z.string(),
  status: z.string().max(30),
  createdById: z.string().uuid(),
  approvedById: z.string().uuid().nullable().optional(),
  approvedAt: z.string().datetime().nullable().optional(),
  executedAt: z.string().datetime().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type PlannedTransitionsDtoScaffold = z.infer<typeof PlannedTransitionsDtoScaffoldSchema>;

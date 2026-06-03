// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const StaffTeamAssignmentsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  staffId: z.string().uuid(),
  orgUnitId: z.string().uuid(),
  startDate: z.string(),
  endDate: z.string().nullable().optional(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  clinicId: z.string().uuid(),
});

export type StaffTeamAssignmentsResponseScaffold = z.infer<typeof StaffTeamAssignmentsResponseScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const StaffLeaveDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  staffId: z.string().uuid(),
  leaveType: z.string().max(50),
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().nullable().optional(),
  coverStaffId: z.string().uuid().nullable().optional(),
  status: z.string().max(30),
  requestedBy: z.string().uuid().nullable().optional(),
  approvedByStaffId: z.string().uuid().nullable().optional(),
  approvedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type StaffLeaveDtoScaffold = z.infer<typeof StaffLeaveDtoScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ClozapineMonitoringChecksDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  registrationId: z.string().uuid(),
  investigation: z.string().max(80),
  checkPoint: z.string().max(30),
  checkDate: z.string().nullable().optional(),
  resultStatus: z.string().max(20).nullable().optional(),
  resultValue: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  recordedByStaffId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type ClozapineMonitoringChecksDtoScaffold = z.infer<typeof ClozapineMonitoringChecksDtoScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ReferralWorkflowEventsResponseScaffoldSchema = z.object({
  clinicId: z.string().uuid(),
  referralId: z.string().uuid(),
  eventType: z.string().max(50),
  performedByStaffId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  outcome: z.string().max(100).nullable().optional(),
  eventAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable().optional(),
});

export type ReferralWorkflowEventsResponseScaffold = z.infer<typeof ReferralWorkflowEventsResponseScaffoldSchema>;

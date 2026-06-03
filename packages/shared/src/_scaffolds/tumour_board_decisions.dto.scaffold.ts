// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const TumourBoardDecisionsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  conditionId: z.string().uuid(),
  meetingDate: z.string(),
  recommendation: z.string(),
  rationale: z.string().nullable().optional(),
  attendeeStaffIds: z.unknown().nullable().optional(),
  chairedByStaffId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type TumourBoardDecisionsDtoScaffold = z.infer<typeof TumourBoardDecisionsDtoScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ReferralStateTransitionsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  referralId: z.string().uuid(),
  fromTaskStatus: z.string().max(20).nullable().optional(),
  toTaskStatus: z.string().max(20),
  actorId: z.string().uuid().nullable().optional(),
  reason: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type ReferralStateTransitionsResponseScaffold = z.infer<typeof ReferralStateTransitionsResponseScaffoldSchema>;

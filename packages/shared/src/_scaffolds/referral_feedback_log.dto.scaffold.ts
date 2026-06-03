// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ReferralFeedbackLogDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  referralId: z.string().uuid(),
  feedbackType: z.string().max(30),
  recipientEmail: z.string().max(255),
  sentAt: z.string().datetime(),
  messageBody: z.string().nullable().optional(),
  sentByStaffId: z.string().uuid().nullable().optional(),
  deliveryStatus: z.string().max(20),
  createdAt: z.string().datetime(),
});

export type ReferralFeedbackLogDtoScaffold = z.infer<typeof ReferralFeedbackLogDtoScaffoldSchema>;

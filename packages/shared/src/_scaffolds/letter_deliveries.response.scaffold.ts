// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const LetterDeliveriesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  letterId: z.string().uuid(),
  channel: z.string().max(30),
  recipientName: z.string().max(300),
  recipientAddress: z.string().max(500).nullable().optional(),
  recipientEmail: z.string().max(200).nullable().optional(),
  recipientFax: z.string().max(30).nullable().optional(),
  recipientMhrIhi: z.string().max(20).nullable().optional(),
  status: z.string().max(20),
  receiptId: z.string().max(200).nullable().optional(),
  sentBy: z.string().uuid(),
  attemptedAt: z.string().datetime().nullable().optional(),
  deliveredAt: z.string().datetime().nullable().optional(),
  error: z.string().nullable().optional(),
  attemptCount: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type LetterDeliveriesResponseScaffold = z.infer<typeof LetterDeliveriesResponseScaffoldSchema>;

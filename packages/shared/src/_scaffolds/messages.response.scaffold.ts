// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const MessagesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  threadId: z.string().uuid().nullable().optional(),
  senderId: z.string().uuid().nullable().optional(),
  clinicId: z.string().uuid(),
  content: z.string().nullable().optional(),
  isRead: z.boolean().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type MessagesResponseScaffold = z.infer<typeof MessagesResponseScaffoldSchema>;

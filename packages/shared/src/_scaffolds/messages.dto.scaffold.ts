// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const MessagesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  threadId: z.string().uuid().nullable().optional(),
  senderId: z.string().uuid().nullable().optional(),
  clinicId: z.string().uuid(),
  content: z.string().nullable().optional(),
  isRead: z.boolean().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type MessagesDtoScaffold = z.infer<typeof MessagesDtoScaffoldSchema>;

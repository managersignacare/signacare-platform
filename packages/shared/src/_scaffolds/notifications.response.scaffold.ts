// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const NotificationsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  recipientStaffId: z.string().uuid().nullable().optional(),
  type: z.string().max(50),
  title: z.string().max(300),
  body: z.string().nullable().optional(),
  link: z.string().max(500).nullable().optional(),
  priority: z.string().max(20).nullable().optional(),
  isRead: z.boolean(),
  readAt: z.string().datetime().nullable().optional(),
  sourceType: z.string().max(50).nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable().optional(),
  updatedAt: z.string().datetime(),
  severity: z.string().max(16).nullable().optional(),
  category: z.string().max(40).nullable().optional(),
  payload: z.unknown().nullable().optional(),
  overridePatientSync: z.boolean(),
});

export type NotificationsResponseScaffold = z.infer<typeof NotificationsResponseScaffoldSchema>;

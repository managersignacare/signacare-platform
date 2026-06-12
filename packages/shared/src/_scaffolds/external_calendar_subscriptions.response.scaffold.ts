// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ExternalCalendarSubscriptionsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  ownerStaffId: z.string().uuid(),
  provider: z.string().max(30),
  externalSubscriptionId: z.string().max(255),
  resource: z.string().max(255),
  notificationUrl: z.string(),
  lifecycleNotificationUrl: z.string().nullable().optional(),
  clientState: z.string().max(255),
  expirationUtc: z.string().datetime(),
  status: z.string().max(30),
  lastNotificationAt: z.string().datetime().nullable().optional(),
  lastRenewedAt: z.string().datetime().nullable().optional(),
  lastError: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type ExternalCalendarSubscriptionsResponseScaffold = z.infer<typeof ExternalCalendarSubscriptionsResponseScaffoldSchema>;

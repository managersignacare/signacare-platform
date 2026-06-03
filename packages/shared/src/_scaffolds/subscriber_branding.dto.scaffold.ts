// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const SubscriberBrandingDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  logoUrl: z.string().nullable().optional(),
  primaryColor: z.string().max(20).nullable().optional(),
  sidebarColor: z.string().max(20).nullable().optional(),
  sidebarTitle: z.string().max(200).nullable().optional(),
  sidebarSubtitle: z.string().max(200).nullable().optional(),
  orgName: z.string().max(200).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type SubscriberBrandingDtoScaffold = z.infer<typeof SubscriberBrandingDtoScaffoldSchema>;

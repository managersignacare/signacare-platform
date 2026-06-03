// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const SubscriberBrandingResponseScaffoldSchema = z.object({
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

export type SubscriberBrandingResponseScaffold = z.infer<typeof SubscriberBrandingResponseScaffoldSchema>;

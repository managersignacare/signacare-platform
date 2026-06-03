// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const CommunityResourcesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  name: z.string().max(300),
  category: z.string().max(50),
  description: z.string().nullable().optional(),
  services: z.string().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().max(255).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  address: z.string().nullable().optional(),
  operatingHours: z.string().nullable().optional(),
  referralProcess: z.string().nullable().optional(),
  eligibility: z.string().nullable().optional(),
  contactPerson: z.string().max(200).nullable().optional(),
  notes: z.string().nullable().optional(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type CommunityResourcesResponseScaffold = z.infer<typeof CommunityResourcesResponseScaffoldSchema>;

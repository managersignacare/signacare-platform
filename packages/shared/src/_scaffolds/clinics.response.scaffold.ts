// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ClinicsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(255),
  legalName: z.string().max(255).nullable().optional(),
  abn: z.string().max(20).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().max(255).nullable().optional(),
  addressLine1: z.string().max(255).nullable().optional(),
  addressLine2: z.string().max(255).nullable().optional(),
  suburb: z.string().max(100).nullable().optional(),
  state: z.string().max(20).nullable().optional(),
  postcode: z.string().max(10).nullable().optional(),
  country: z.string().max(10).nullable().optional(),
  timezone: z.string().max(100).nullable().optional(),
  timeZone: z.string().max(100).nullable().optional(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
  hpio: z.string().max(16).nullable().optional(),
  npdsConformanceId: z.string().max(64).nullable().optional(),
  erxEtp1SiteId: z.string().max(64).nullable().optional(),
  sessionIdleMinutes: z.number().int().nullable().optional(),
});

export type ClinicsResponseScaffold = z.infer<typeof ClinicsResponseScaffoldSchema>;

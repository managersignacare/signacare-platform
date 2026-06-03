// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const HotspotsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  hotspotType: z.string().max(50).nullable().optional(),
  reason: z.string().nullable().optional(),
  severity: z.string().max(30).nullable().optional(),
  isActive: z.boolean().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable().optional(),
});

export type HotspotsDtoScaffold = z.infer<typeof HotspotsDtoScaffoldSchema>;

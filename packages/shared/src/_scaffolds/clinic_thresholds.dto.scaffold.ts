// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ClinicThresholdsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid().nullable().optional(),
  thresholdKey: z.string().max(100).nullable().optional(),
  thresholdValue: z.string().regex(/^-?\d{1,6}(\.\d{0,2})?$/).nullable().optional(),
  unit: z.string().max(50).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ClinicThresholdsDtoScaffold = z.infer<typeof ClinicThresholdsDtoScaffoldSchema>;

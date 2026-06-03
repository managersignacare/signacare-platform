// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PatientDeviceSourcesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  provider: z.string().max(40),
  deviceLabel: z.string().max(120),
  externalDeviceId: z.string().max(200).nullable().optional(),
  isActive: z.boolean(),
  metadata: z.unknown(),
  lastIngestedAt: z.string().datetime().nullable().optional(),
  lockVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PatientDeviceSourcesResponseScaffold = z.infer<typeof PatientDeviceSourcesResponseScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PatientDutyRelationshipsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  staffId: z.string().uuid(),
  createdById: z.string().uuid().nullable().optional(),
  relationshipType: z.string().max(40),
  reason: z.string(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable().optional(),
  revokedById: z.string().uuid().nullable().optional(),
  lockVersion: z.number().int(),
});

export type PatientDutyRelationshipsResponseScaffold = z.infer<typeof PatientDutyRelationshipsResponseScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ConsentRecordsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  consentType: z.string().max(100),
  status: z.string().max(30),
  grantedAt: z.string().datetime().nullable().optional(),
  withdrawnAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  witnessName: z.string().max(255).nullable().optional(),
  witnessRole: z.string().max(100).nullable().optional(),
  notes: z.string().nullable().optional(),
  recordedById: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ConsentRecordsResponseScaffold = z.infer<typeof ConsentRecordsResponseScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const CarersResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  clinicId: z.string().uuid(),
  givenName: z.string().max(100),
  familyName: z.string().max(100).nullable().optional(),
  relationship: z.string().max(100).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().max(255).nullable().optional(),
  isPrimary: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable().optional(),
});

export type CarersResponseScaffold = z.infer<typeof CarersResponseScaffoldSchema>;

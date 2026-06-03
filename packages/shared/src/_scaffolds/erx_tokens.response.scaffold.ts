// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ErxTokensResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  prescriptionId: z.string().uuid(),
  tokenValue: z.string().max(500),
  dspId: z.string().max(100).nullable().optional(),
  npdsReference: z.string().max(100).nullable().optional(),
  status: z.string().max(30),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable().optional(),
  dispensedAt: z.string().datetime().nullable().optional(),
  dispensingPharmacy: z.string().max(300).nullable().optional(),
  rawResponse: z.unknown().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ErxTokensResponseScaffold = z.infer<typeof ErxTokensResponseScaffoldSchema>;

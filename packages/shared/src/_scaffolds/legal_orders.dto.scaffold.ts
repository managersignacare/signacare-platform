// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const LegalOrdersDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  orderTypeId: z.string().uuid(),
  orderNumber: z.string().max(50).nullable().optional(),
  startDate: z.string(),
  expiresAt: z.string().nullable().optional(),
  reviewDate: z.string().nullable().optional(),
  status: z.string().max(30),
  issuingAuthority: z.string().max(200).nullable().optional(),
  conditions: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  autoFlagged: z.boolean(),
  createdByStaffId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
  lockVersion: z.number().int(),
});

export type LegalOrdersDtoScaffold = z.infer<typeof LegalOrdersDtoScaffoldSchema>;

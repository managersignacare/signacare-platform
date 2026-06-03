// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const TrainingExportRequestsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  requestedById: z.string().uuid(),
  requestedAt: z.string().datetime(),
  approvedById: z.string().uuid().nullable().optional(),
  approvedAt: z.string().datetime().nullable().optional(),
  status: z.string().max(20),
  format: z.string().max(20),
  reason: z.string().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
  downloadToken: z.string().uuid().nullable().optional(),
  downloadedAt: z.string().datetime().nullable().optional(),
  rowCount: z.number().int().nullable().optional(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export type TrainingExportRequestsDtoScaffold = z.infer<typeof TrainingExportRequestsDtoScaffoldSchema>;

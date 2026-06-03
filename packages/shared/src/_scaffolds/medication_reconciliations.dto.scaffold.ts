// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const MedicationReconciliationsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  context: z.string().max(30),
  performedAt: z.string().datetime(),
  performedBy: z.string().uuid().nullable().optional(),
  snapshot: z.unknown(),
  continuedCount: z.number().int(),
  ceasedCount: z.number().int(),
  modifiedCount: z.number().int(),
  newCount: z.number().int(),
  onHoldCount: z.number().int(),
  summaryNotes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type MedicationReconciliationsDtoScaffold = z.infer<typeof MedicationReconciliationsDtoScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ChecklistInstancesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  templateId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  completedByStaffId: z.string().uuid().nullable().optional(),
  status: z.string().max(20),
  checkedItems: z.unknown(),
  totalItems: z.number().int(),
  completedItems: z.number().int(),
  notes: z.string().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ChecklistInstancesDtoScaffold = z.infer<typeof ChecklistInstancesDtoScaffoldSchema>;

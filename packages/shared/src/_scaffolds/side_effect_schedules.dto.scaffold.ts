// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const SideEffectSchedulesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  patientMedicationId: z.string().uuid().nullable().optional(),
  scheduleType: z.string().max(50),
  frequencyWeeks: z.number().int(),
  nextDueDate: z.string().nullable().optional(),
  lastCompletedDate: z.string().nullable().optional(),
  parameters: z.unknown(),
  notes: z.string().nullable().optional(),
  status: z.string().max(30),
  createdById: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type SideEffectSchedulesDtoScaffold = z.infer<typeof SideEffectSchedulesDtoScaffoldSchema>;

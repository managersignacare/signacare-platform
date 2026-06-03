// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PatientRoutineEventsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  routineId: z.string().uuid().nullable().optional(),
  eventType: z.string().max(64),
  valueNumeric: z.string().regex(/^-?\d{1,8}(\.\d{0,2})?$/).nullable().optional(),
  valueText: z.string().max(500).nullable().optional(),
  occurredAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export type PatientRoutineEventsDtoScaffold = z.infer<typeof PatientRoutineEventsDtoScaffoldSchema>;

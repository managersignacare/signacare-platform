// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PatientMedRemindersDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  medicationId: z.string().uuid().nullable().optional(),
  drugName: z.string().max(255),
  dose: z.string().max(100).nullable().optional(),
  instructions: z.string(),
  daysOfWeek: z.unknown(),
  reminderTime: z.string(),
  isActive: z.boolean(),
  createdBy: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PatientMedRemindersDtoScaffold = z.infer<typeof PatientMedRemindersDtoScaffoldSchema>;

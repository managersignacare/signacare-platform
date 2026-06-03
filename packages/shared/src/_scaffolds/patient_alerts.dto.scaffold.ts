// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PatientAlertsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  clinicId: z.string().uuid(),
  alertTypeId: z.string().uuid(),
  enteredById: z.string().uuid().nullable().optional(),
  title: z.string().max(300),
  notes: z.string().nullable().optional(),
  managementPlan: z.string().nullable().optional(),
  severity: z.string().max(30),
  isActive: z.boolean(),
  showFlag: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable().optional(),
});

export type PatientAlertsDtoScaffold = z.infer<typeof PatientAlertsDtoScaffoldSchema>;

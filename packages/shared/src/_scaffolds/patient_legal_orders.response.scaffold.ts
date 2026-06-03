// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PatientLegalOrdersResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  clinicId: z.string().uuid(),
  orderTypeId: z.string().uuid(),
  enteredById: z.string().uuid().nullable().optional(),
  orderNumber: z.string().max(50).nullable().optional(),
  startDate: z.string(),
  endDate: z.string().nullable().optional(),
  reviewDate: z.string().nullable().optional(),
  nextApplicationDate: z.string().nullable().optional(),
  status: z.string().max(30),
  notes: z.string().nullable().optional(),
  aiSummary: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lockVersion: z.number().int(),
});

export type PatientLegalOrdersResponseScaffold = z.infer<typeof PatientLegalOrdersResponseScaffoldSchema>;

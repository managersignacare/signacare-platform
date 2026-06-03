// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ClozapineBloodResultsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  registrationId: z.string().uuid(),
  recordedByStaffId: z.string().uuid(),
  collectionDate: z.string(),
  resultedDate: z.string().nullable().optional(),
  ancValue: z.string().regex(/^-?\d{1,6}(\.\d{0,2})?$/).nullable().optional(),
  wbcValue: z.string().regex(/^-?\d{1,6}(\.\d{0,2})?$/).nullable().optional(),
  neutrophilsPct: z.string().regex(/^-?\d{1,6}(\.\d{0,2})?$/).nullable().optional(),
  ancStatus: z.string().max(30),
  flagRaised: z.boolean(),
  flagType: z.string().max(50).nullable().optional(),
  labName: z.string().max(200).nullable().optional(),
  labReference: z.string().max(100).nullable().optional(),
  clinicalNotes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type ClozapineBloodResultsResponseScaffold = z.infer<typeof ClozapineBloodResultsResponseScaffoldSchema>;

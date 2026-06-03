// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PathologyResultsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  pathologyOrderId: z.string().uuid(),
  patientId: z.string().uuid(),
  testCode: z.string().max(50),
  testName: z.string().max(200),
  resultValue: z.string().max(200),
  resultUnit: z.string().max(50).nullable().optional(),
  referenceRange: z.string().max(100).nullable().optional(),
  abnormalFlag: z.string().max(30),
  resultStatus: z.string().max(30),
  collectionDate: z.string(),
  resultDate: z.string(),
  collectedAt: z.string().datetime().nullable().optional(),
  performingLab: z.string().max(200).nullable().optional(),
  hl7Raw: z.string().nullable().optional(),
  isCritical: z.boolean().nullable().optional(),
  criticalAcknowledgedAt: z.string().datetime().nullable().optional(),
  criticalAcknowledgedById: z.string().uuid().nullable().optional(),
  flagTaskId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lockVersion: z.number().int(),
});

export type PathologyResultsDtoScaffold = z.infer<typeof PathologyResultsDtoScaffoldSchema>;

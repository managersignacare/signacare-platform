// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const AiProvenanceDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  jobId: z.string().uuid().nullable().optional(),
  patientId: z.string().uuid().nullable().optional(),
  action: z.string().max(100),
  outputHash: z.string().max(128),
  outputLength: z.number().int(),
  modelName: z.string().max(200),
  modelVersion: z.string().max(255),
  promptTemplateVersion: z.string().max(100),
  sourceDataSummary: z.string().nullable().optional(),
  validated: z.boolean(),
  validationWarnings: z.unknown(),
  createdByStaffId: z.string().uuid().nullable().optional(),
  reviewedByStaffId: z.string().uuid().nullable().optional(),
  reviewedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AiProvenanceDtoScaffold = z.infer<typeof AiProvenanceDtoScaffoldSchema>;

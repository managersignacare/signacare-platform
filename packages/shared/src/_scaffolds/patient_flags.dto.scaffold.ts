// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PatientFlagsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  category: z.string().max(50),
  severity: z.string().max(30),
  title: z.string().max(300),
  description: z.string().nullable().optional(),
  status: z.string().max(30),
  raisedByStaffId: z.string().uuid().nullable().optional(),
  resolvedByStaffId: z.string().uuid().nullable().optional(),
  raisedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable().optional(),
  relatedRecordType: z.string().max(50).nullable().optional(),
  relatedRecordId: z.string().uuid().nullable().optional(),
  isHeaderFlag: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type PatientFlagsDtoScaffold = z.infer<typeof PatientFlagsDtoScaffoldSchema>;

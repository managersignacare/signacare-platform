// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ProblemListDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  codeSystem: z.string().max(50),
  code: z.string().max(40),
  display: z.string().max(500),
  category: z.string().max(30),
  clinicalStatus: z.string().max(20),
  verificationStatus: z.string().max(20),
  severity: z.string().max(20).nullable().optional(),
  isChronic: z.boolean(),
  onsetDate: z.string().nullable().optional(),
  onsetAgeYears: z.unknown().nullable().optional(),
  abatementDate: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  recordedDate: z.string().datetime(),
  recordedBy: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type ProblemListDtoScaffold = z.infer<typeof ProblemListDtoScaffoldSchema>;

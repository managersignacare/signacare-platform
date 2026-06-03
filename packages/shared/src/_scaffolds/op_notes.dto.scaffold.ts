// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const OpNotesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  caseId: z.string().uuid(),
  indication: z.string(),
  findings: z.string(),
  procedureText: z.string(),
  complications: z.string().nullable().optional(),
  estimatedBloodLossMl: z.number().int().nullable().optional(),
  specimens: z.unknown(),
  closedBy: z.string().uuid().nullable().optional(),
  closedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type OpNotesDtoScaffold = z.infer<typeof OpNotesDtoScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const KeyIssuesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  issueText: z.string(),
  category: z.string().max(50),
  priority: z.string().max(30),
  resolution: z.string().nullable().optional(),
  resolvedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type KeyIssuesDtoScaffold = z.infer<typeof KeyIssuesDtoScaffoldSchema>;

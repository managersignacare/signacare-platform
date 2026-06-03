// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const AuditRunsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  templateId: z.string().uuid(),
  teamId: z.string().uuid().nullable().optional(),
  clinicianId: z.string().uuid().nullable().optional(),
  sampleSize: z.number().int(),
  status: z.string().max(30),
  selectedNoteIds: z.unknown(),
  results: z.unknown().nullable().optional(),
  createdById: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AuditRunsDtoScaffold = z.infer<typeof AuditRunsDtoScaffoldSchema>;

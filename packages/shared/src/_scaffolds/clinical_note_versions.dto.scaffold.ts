// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ClinicalNoteVersionsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  noteId: z.string().uuid(),
  clinicId: z.string().uuid(),
  versionNumber: z.number().int(),
  snapshot: z.unknown(),
  editedByStaffId: z.string().uuid(),
  editedAt: z.string().datetime(),
  editReason: z.string().nullable().optional(),
  statusAtSnapshot: z.string().max(30).nullable().optional(),
});

export type ClinicalNoteVersionsDtoScaffold = z.infer<typeof ClinicalNoteVersionsDtoScaffoldSchema>;

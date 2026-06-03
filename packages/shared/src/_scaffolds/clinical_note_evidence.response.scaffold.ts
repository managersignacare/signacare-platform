// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ClinicalNoteEvidenceResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  noteId: z.string().uuid(),
  chunkId: z.string().uuid(),
  clinicId: z.string().uuid(),
  quotedExcerpt: z.string().nullable().optional(),
  section: z.string().max(32).nullable().optional(),
  status: z.string().max(16),
  source: z.string().max(32),
  acceptedByStaffId: z.string().uuid().nullable().optional(),
  acceptedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  lockVersion: z.number().int(),
});

export type ClinicalNoteEvidenceResponseScaffold = z.infer<typeof ClinicalNoteEvidenceResponseScaffoldSchema>;

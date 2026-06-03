// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ClinicalNoteCodesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  noteId: z.string().uuid(),
  clinicId: z.string().uuid(),
  system: z.string().max(32),
  code: z.string().max(64),
  display: z.string(),
  confidence: z.string().max(16),
  status: z.string().max(16),
  source: z.string().max(32),
  sourceExcerpt: z.string().nullable().optional(),
  acceptedByStaffId: z.string().uuid().nullable().optional(),
  acceptedAt: z.string().datetime().nullable().optional(),
  rejectedByStaffId: z.string().uuid().nullable().optional(),
  rejectedAt: z.string().datetime().nullable().optional(),
  rejectReason: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lockVersion: z.number().int(),
});

export type ClinicalNoteCodesResponseScaffold = z.infer<typeof ClinicalNoteCodesResponseScaffoldSchema>;

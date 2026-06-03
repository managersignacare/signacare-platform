// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const CorrespondenceLettersResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  clinicId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  authorId: z.string().uuid().nullable().optional(),
  recipientName: z.string().max(255).nullable().optional(),
  recipientAddress: z.string().nullable().optional(),
  recipientEmail: z.string().max(255).nullable().optional(),
  recipientFax: z.string().max(30).nullable().optional(),
  recipientProviderId: z.string().uuid().nullable().optional(),
  letterType: z.string().max(50),
  subject: z.string().max(500).nullable().optional(),
  content: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  status: z.string().max(30),
  clinicalNoteId: z.string().uuid().nullable().optional(),
  templateId: z.string().uuid().nullable().optional(),
  generatedById: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  sentVia: z.string().max(50).nullable().optional(),
  createdAt: z.string().datetime(),
  sentAt: z.string().datetime().nullable().optional(),
  deletedAt: z.string().datetime().nullable().optional(),
  signatureData: z.string().nullable().optional(),
  signedById: z.string().uuid().nullable().optional(),
  signedAt: z.string().datetime().nullable().optional(),
});

export type CorrespondenceLettersResponseScaffold = z.infer<typeof CorrespondenceLettersResponseScaffoldSchema>;

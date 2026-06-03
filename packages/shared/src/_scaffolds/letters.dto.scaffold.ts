// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const LettersDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  templateId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  authorId: z.string().uuid(),
  sessionId: z.string().uuid().nullable().optional(),
  status: z.string().max(20),
  subject: z.string().max(300),
  recipients: z.unknown(),
  renderedText: z.string().nullable().optional(),
  approvedBy: z.string().uuid().nullable().optional(),
  approvedAt: z.string().datetime().nullable().optional(),
  sentBy: z.string().uuid().nullable().optional(),
  sentAt: z.string().datetime().nullable().optional(),
  revision: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type LettersDtoScaffold = z.infer<typeof LettersDtoScaffoldSchema>;

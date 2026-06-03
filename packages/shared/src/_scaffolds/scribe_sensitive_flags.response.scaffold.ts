// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ScribeSensitiveFlagsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  sessionId: z.string().uuid(),
  patientId: z.string().uuid(),
  category: z.string().max(40),
  severity: z.string().max(20),
  transcriptOffset: z.number().int().nullable().optional(),
  snippet: z.string().max(200).nullable().optional(),
  reviewedBy: z.string().uuid().nullable().optional(),
  reviewedAt: z.string().datetime().nullable().optional(),
  reviewDisposition: z.string().max(40).nullable().optional(),
  createdAt: z.string().datetime(),
});

export type ScribeSensitiveFlagsResponseScaffold = z.infer<typeof ScribeSensitiveFlagsResponseScaffoldSchema>;

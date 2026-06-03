// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ScribeSessionsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  clinicianId: z.string().uuid(),
  patientId: z.string().uuid(),
  consentId: z.string().uuid().nullable().optional(),
  status: z.string().max(20),
  whisperMode: z.boolean(),
  startedAt: z.string().datetime(),
  pausedAt: z.string().datetime().nullable().optional(),
  resumedAt: z.string().datetime().nullable().optional(),
  endedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ScribeSessionsResponseScaffold = z.infer<typeof ScribeSessionsResponseScaffoldSchema>;

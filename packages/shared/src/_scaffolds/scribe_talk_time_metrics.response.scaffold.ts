// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ScribeTalkTimeMetricsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  sessionId: z.string().uuid(),
  clinicianSeconds: z.number().int(),
  patientSeconds: z.number().int(),
  silenceSeconds: z.number().int(),
  totalSeconds: z.number().int(),
  createdAt: z.string().datetime(),
});

export type ScribeTalkTimeMetricsResponseScaffold = z.infer<typeof ScribeTalkTimeMetricsResponseScaffoldSchema>;

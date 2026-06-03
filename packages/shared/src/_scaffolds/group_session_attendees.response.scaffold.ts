// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const GroupSessionAttendeesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  groupSessionId: z.string().uuid(),
  patientId: z.string().uuid(),
  attendanceStatus: z.string().max(30),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable().optional(),
});

export type GroupSessionAttendeesResponseScaffold = z.infer<typeof GroupSessionAttendeesResponseScaffoldSchema>;

// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PathologyOrdersDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  appointmentId: z.string().uuid().nullable().optional(),
  orderedById: z.string().uuid(),
  orderNumber: z.string().max(50),
  panelName: z.string().max(200),
  tests: z.unknown(),
  urgency: z.string().max(30),
  clinicalNotes: z.string().nullable().optional(),
  fasting: z.boolean().nullable().optional(),
  copyToGp: z.boolean().nullable().optional(),
  status: z.string().max(30),
  hl7SentAt: z.string().datetime().nullable().optional(),
  hl7Message: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type PathologyOrdersDtoScaffold = z.infer<typeof PathologyOrdersDtoScaffoldSchema>;

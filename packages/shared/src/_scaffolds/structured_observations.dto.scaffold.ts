// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const StructuredObservationsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  staffId: z.string().uuid().nullable().optional(),
  observationType: z.string().max(50),
  location: z.string().max(100).nullable().optional(),
  mood: z.string().max(100).nullable().optional(),
  behaviour: z.string().max(100).nullable().optional(),
  riskConcerns: z.string().nullable().optional(),
  sleepQuality: z.string().max(50).nullable().optional(),
  values: z.unknown().nullable().optional(),
  notes: z.string().nullable().optional(),
  observedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  escalationRequired: z.boolean(),
  escalationNotes: z.string().nullable().optional(),
});

export type StructuredObservationsDtoScaffold = z.infer<typeof StructuredObservationsDtoScaffoldSchema>;

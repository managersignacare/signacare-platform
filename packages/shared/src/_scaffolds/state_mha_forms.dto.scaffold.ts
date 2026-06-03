// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const StateMhaFormsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  stateCode: z.string().max(3),
  formCode: z.string().max(40),
  name: z.string().max(300),
  actReference: z.string().max(200),
  sectionReference: z.string().max(40).nullable().optional(),
  fieldSchema: z.unknown(),
  requiresAuthorisedPsychiatrist: z.boolean(),
  maxDurationDays: z.number().int().nullable().optional(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type StateMhaFormsDtoScaffold = z.infer<typeof StateMhaFormsDtoScaffoldSchema>;

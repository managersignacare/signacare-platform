// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const EscalationsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid().nullable().optional(),
  episodeId: z.string().uuid().nullable().optional(),
  raisedById: z.string().uuid().nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  acknowledgedById: z.string().uuid().nullable().optional(),
  resolvedById: z.string().uuid().nullable().optional(),
  type: z.string().max(50).nullable().optional(),
  severity: z.string().max(30).nullable().optional(),
  title: z.string().max(300).nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.string().max(30).nullable().optional(),
  resolution: z.string().nullable().optional(),
  acknowledgedAt: z.string().datetime().nullable().optional(),
  resolvedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
  lockVersion: z.number().int(),
});

export type EscalationsDtoScaffold = z.infer<typeof EscalationsDtoScaffoldSchema>;

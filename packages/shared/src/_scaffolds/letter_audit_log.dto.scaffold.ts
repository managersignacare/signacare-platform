// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const LetterAuditLogDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  letterId: z.string().uuid(),
  event: z.string().max(40),
  actorId: z.string().uuid(),
  actorRole: z.string().max(60),
  sectionKey: z.string().max(60).nullable().optional(),
  diffSummary: z.unknown().nullable().optional(),
  ipAddress: z.string().max(64).nullable().optional(),
  createdAt: z.string().datetime(),
});

export type LetterAuditLogDtoScaffold = z.infer<typeof LetterAuditLogDtoScaffoldSchema>;

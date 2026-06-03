// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const BackupHistoryDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable().optional(),
  status: z.string().max(16),
  sizeBytes: z.number().int().nullable().optional(),
  location: z.string().nullable().optional(),
  errorText: z.string().nullable().optional(),
  triggerKind: z.string().max(16),
  triggeredByStaffId: z.string().uuid().nullable().optional(),
});

export type BackupHistoryDtoScaffold = z.infer<typeof BackupHistoryDtoScaffoldSchema>;
